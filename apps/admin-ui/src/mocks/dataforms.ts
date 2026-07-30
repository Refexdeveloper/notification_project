export interface DataformField {
  id: string;
  name: string;
  label: string;
  type: string;
  category: string;
  required: boolean;
}

export interface Dataform {
  id: string;
  appId: string;
  name: string;
  description: string;
  icon: string;
  owner: string;
  fieldsCount: number;
  templatesCount: number;
  schedulersCount: number;
  updatedAt: string;
  fields: DataformField[];
}

/** Categories for the field picker — populated after Kissflow sync, not seeded. */
export const fieldCategories: {
  id: string;
  label: string;
  icon: string;
  fields: DataformField[];
}[] = [];

/** Template variables — filled from synced fields later. */
export const notificationVariables: {
  id: string;
  name: string;
  variable: string;
  icon: string;
  color: string;
}[] = [];

export const dataforms: Dataform[] = [];

export const getDataformsByAppId = (appId: string): Dataform[] =>
  dataforms.filter((d) => d.appId === appId);

export const getDataformById = (id: string): Dataform | undefined =>
  dataforms.find((d) => d.id === id);
