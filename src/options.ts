export interface DbCommandOptions {
  json: boolean;
  dbFlag?: string;
}

export interface PlanCommandOptions extends DbCommandOptions {
  from: string;
  to: string;
  alsoProjectTables: boolean;
}
