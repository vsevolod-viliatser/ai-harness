// Slack: tokens from the macOS keychain, your user id from project/config.json, a DM channel with you.
import { WebClient } from "@slack/web-api";
import { PROJECT } from "../config.ts";
import { must } from "../core/shell.ts";

const keychain = (service: string) => must("security", ["find-generic-password", "-s", service, "-w"]).trim();

export const botToken = () => keychain("harness-slack-bot"); // xoxb-…: post messages
export const appToken = () => keychain("harness-slack-app"); // xapp-…: the Socket Mode connection

export const me = (): string => PROJECT.slackUserId;

export const slack = () => new WebClient(botToken());

// The DM between the bot and you.
export async function dmChannel(client: WebClient): Promise<string> {
    const r = await client.conversations.open({ users: me() });
    return r.channel!.id!;
}
