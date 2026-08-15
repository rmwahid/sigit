import { api } from "./client";
import { API_PATHS } from "$lib/constants/paths";

export type AppInfo = {
  gitBaseUrl: string;
};

export async function getAppInfo() {
  return api<{ data: AppInfo }>(API_PATHS.APP_INFO);
}
