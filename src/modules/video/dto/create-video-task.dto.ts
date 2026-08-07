export interface CreateVideoTaskDto {
  title: string;
  category?: string;
  course?: string;
  batchId?: string;
  batchName?: string;
  priority?: "Low" | "Medium" | "High";
  submissionDate: string;
  cutOffTime?: string;
  strictDeadline?: boolean;
  detailedInstructions?: string;
  referenceFileUrl?: string;
}
