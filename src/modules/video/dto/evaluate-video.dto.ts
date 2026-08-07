export interface EvaluateVideoDto {
  score: number;
  status: "REVIEWED" | "NEEDS_IMPROVEMENT";
  correctionNotes?: string[];
  overallReview?: string;
}
