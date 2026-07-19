import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { db } from '../lib/db.js';
import { agentRuns, applications, jobPostings, users } from '@applypilot/database';
import { type PlannerDecision, type PlannerRoute } from '@applypilot/shared';
import { planSingleJob } from './planner.js';
import { tailorSingleJob } from './tailor.js';

const JobGraphState = Annotation.Root({
  userEmail: Annotation<string>,
  jobPostingId: Annotation<string>,
  plannerDecision: Annotation<PlannerDecision | undefined>,
  route: Annotation<PlannerRoute | undefined>,
  plannerResult: Annotation<Record<string, unknown> | undefined>,
  tailoredResult: Annotation<Record<string, unknown> | undefined>,
  trackResult: Annotation<Record<string, unknown> | undefined>,
});

const buildThreadId = (userEmail: string, jobPostingId: string) =>
  createHash('sha256').update(`${userEmail}:${jobPostingId}`).digest('hex').slice(0, 48);

let graphPromise: Promise<any> | null = null;

const trackSingleJob = async (input: { userEmail: string; jobPostingId: string }) => {
  const [user] = await db.select().from(users).where(eq(users.email, input.userEmail)).limit(1);
  if (!user) throw new Error('User not found for tracker');

  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, user.id), eq(applications.jobPostingId, input.jobPostingId)))
    .orderBy(desc(applications.createdAt))
    .limit(1);

  const [jobPosting] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, input.jobPostingId))
    .limit(1);

  await db.insert(agentRuns).values({
    userId: user.id,
    agentType: 'tracker',
    jobPostingId: input.jobPostingId,
    inputJson: {
      userEmail: input.userEmail,
      jobPostingId: input.jobPostingId,
    },
    outputJson: {
      application,
      jobPosting,
    },
    tokensUsed: 0,
    costUsd: '0.0000',
    status: 'success',
  });

  return {
    application,
    jobPosting,
    trackedAt: new Date().toISOString(),
  };
};

const getGraph = async () => {
  if (!graphPromise) {
    graphPromise = (async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new Error('DATABASE_URL is required for LangGraph checkpointing');

      const checkpointer = PostgresSaver.fromConnString(databaseUrl);
      await checkpointer.setup();

      const graph = new StateGraph(JobGraphState)
        .addNode('planner', async (state) => {
          const result = await planSingleJob({
            userEmail: state.userEmail,
            jobPostingId: state.jobPostingId,
          });

          return {
            plannerDecision: result.plannerDecision,
            route: result.route,
            plannerResult: {
              autonomyThreshold: result.autonomyThreshold,
              plannerDecision: result.plannerDecision,
              route: result.route,
            },
          };
        })
        .addNode('tailor', async (state) => {
          if (!state.plannerDecision) {
            throw new Error('Planner decision missing before tailor node');
          }

          const result = await tailorSingleJob({
            userEmail: state.userEmail,
            jobPostingId: state.jobPostingId,
            plannerDecision: state.plannerDecision,
          });

          return {
            tailoredResult: {
              application: result.application,
              tailoredResume: result.tailoredResume,
              coverLetterText: result.coverLetterText,
              complianceNotes: result.complianceNotes,
            },
          };
        })
        .addNode('track', async (state) => {
          const result = await trackSingleJob({
            userEmail: state.userEmail,
            jobPostingId: state.jobPostingId,
          });

          return {
            trackResult: result,
          };
        })
        .addEdge(START, 'planner')
        .addConditionalEdges('planner', (state) => (state.route === 'tailor' ? 'tailor' : END))
        .addEdge('tailor', 'track')
        .addEdge('track', END)
        .compile({ checkpointer });

      return graph;
    })();
  }

  return graphPromise;
};

export const processSingleJobGraph = async (input: { userEmail: string; jobPostingId: string }) => {
  const graph = await getGraph();
  const threadId = buildThreadId(input.userEmail, input.jobPostingId);
  const config = { configurable: { thread_id: threadId, checkpoint_ns: 'applypilot-job-graph' } };

  const state = await graph.invoke(
    {
      userEmail: input.userEmail,
      jobPostingId: input.jobPostingId,
    },
    config,
  );

  return {
    threadId,
    state,
  };
};

export const resumeSingleJobGraph = async (input: { userEmail: string; jobPostingId: string }) => {
  const graph = await getGraph();
  const threadId = buildThreadId(input.userEmail, input.jobPostingId);
  const config = { configurable: { thread_id: threadId, checkpoint_ns: 'applypilot-job-graph' } };

  const state = await graph.invoke(
    {
      userEmail: input.userEmail,
      jobPostingId: input.jobPostingId,
    },
    config,
  );

  const snapshot = await graph.getState(config);

  return {
    threadId,
    state,
    snapshot: {
      values: snapshot.values,
      next: snapshot.next,
    },
  };
};

export const getJobGraphState = async (input: { userEmail: string; jobPostingId: string }) => {
  const graph = await getGraph();
  const threadId = buildThreadId(input.userEmail, input.jobPostingId);
  const config = { configurable: { thread_id: threadId, checkpoint_ns: 'applypilot-job-graph' } };
  const snapshot = await graph.getState(config);

  return {
    threadId,
    snapshot: {
      values: snapshot.values,
      next: snapshot.next,
    },
  };
};
