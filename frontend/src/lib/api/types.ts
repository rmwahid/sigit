export type Connection = {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  useEncryption: boolean;
};

export type NewConnection = Omit<Connection, "id"> & {
  accessKeyId: string;
  secretAccessKey: string;
  encryptionSalt?: string;
};

export type NewConnectionInput = {
  name: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
  useEncryption?: boolean;
};

export type CreateProjectWithConnectionInput = {
  name: string;
  description?: string;
  connection: NewConnectionInput;
};

export type Project = {
  id: string;
  name: string;
  description?: string;
  storageConnectionId: string | null;
  lfsSizeThreshold: number;
  lfsPatterns?: string;
  useEncryption: boolean;
};

export type NewProject = Omit<Project, "id" | "storageConnectionId"> & {
  storageConnectionId: string;
};

export type DeleteProjectResult = {
  deletedDb: boolean;
  deletedRepo: boolean;
  deletedS3Objects: number;
  hadStorage: boolean;
};

export type CurrentUser = { id: string; email: string };

export type LogEntry = {
  ts: string;
  scope: string;
  message: string;
  level?: string;
  event?: string;
};
