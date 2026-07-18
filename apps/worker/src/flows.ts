import { queueNames, createFlowProducer } from '@applypilot/pipeline';

export const enqueueTailorFlow = async (input: {
  redisUrl: string;
  userEmail: string;
  jobPostingId: string;
  plannerDecision: unknown;
}) => {
  const flow = createFlowProducer(input.redisUrl);
  try {
    return await flow.add({
      name: queueNames.tailor,
      queueName: queueNames.tailor,
      data: {
        userEmail: input.userEmail,
        jobPostingId: input.jobPostingId,
        plannerDecision: input.plannerDecision,
      },
      opts: {
        attempts: 2,
        removeOnComplete: true,
      },
      children: [
        {
          name: queueNames.track,
          queueName: queueNames.track,
          data: {
            userEmail: input.userEmail,
            jobPostingId: input.jobPostingId,
          },
          opts: {
            attempts: 1,
            removeOnComplete: true,
          },
        },
      ],
    });
  } finally {
    await flow.close();
  }
};
