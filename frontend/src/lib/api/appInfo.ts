import { api } from "./client";

export type AppInfo = {
  gitBaseUrl: string;
};

export async function getAppInfo() {
  return api<{ data: AppInfo }>("/app-info");
}
