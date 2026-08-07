export interface SubmitStudentVideoDto {
  taskId?: string;
  videoTitle: string;
  fileUrl: string;
  courseAndBatch?: string;
}
