import { listProjects, type Project } from "$lib/api";

let projects = $state<Project[]>([]);
let loaded = false;

export const projectsStore = {
  get list() {
    return projects;
  },
  get isLoaded() {
    return loaded;
  },
  async refresh(): Promise<Project[]> {
    const res = await listProjects();
    projects = res.data;
    loaded = true;
    return projects;
  },
  remove(id: string) {
    projects = projects.filter((p) => p.id !== id);
  },
};
