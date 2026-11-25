// How a run talks back. stage() lines go to the task's Slack thread (the bot reads the run's stdout);
// `result` is written to the --result file at the end, for the bot to decide what happens next.
export const result: {
    verdict?: string; questions?: string[]; reason?: string;
    plan?: string; autoStart?: boolean; // a one-PR plan without a migration starts without Approve
    pr?: string; phase?: number; phases?: number;
} = {};

export const stage = (text: string): void => console.log(`@@stage ${text}`);
