import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { Prisma } from "@prisma/client";

const normalizeParam = (
  param: string | string[] | undefined
): string | undefined => (Array.isArray(param) ? param[0] : param);

/* =========================================================
   TYPES
========================================================= */

interface ExamOption {
  id?: string;
  text?: string;
  isCorrect?: boolean;
}

interface ExamQuestion {
  id?: string;
  questionText?: string;
  text?: string;
  questionType?: string;
  options?: ExamOption[];
  mediaUrl?: string;
  imageUrl?: string;
  marks?: number;
}

interface AnswersData {
  [questionId: string]: unknown;
}

interface QuestionEvaluation {
  marks: number;
  maxMarks: number;

  status:
    | "CORRECT"
    | "INCORRECT"
    | "PARTIAL"
    | "UNANSWERED"
    | "PENDING";

  feedback?: string;

  selectedAnswer?: string | null;
  correctAnswer?: string | null;
}

/* =========================================================
   HELPERS
========================================================= */

const getStudentId = (req: Request): string | undefined => {
  return (req as any).user?.id;
};

const getQuestions = (questionsData: unknown): ExamQuestion[] => {
  if (!Array.isArray(questionsData)) {
    return [];
  }

  return questionsData.filter(
    (question): question is ExamQuestion =>
      typeof question === "object" &&
      question !== null
  );
};

const getExamWindow = (
  examDate: Date,
  durationMins: number
): {
  start: Date;
  end: Date;
} => {
  const start = new Date(examDate);

  const end = new Date(
    start.getTime() + durationMins * 60 * 1000
  );

  return {
    start,
    end,
  };
};

const sanitizeAnswers = (
  answers: unknown,
  questions: ExamQuestion[]
): Record<string, string> => {
  if (
    !answers ||
    typeof answers !== "object" ||
    Array.isArray(answers)
  ) {
    return {};
  }

  const rawAnswers = answers as AnswersData;

  const validQuestionIds = new Set(
    questions
      .map((question, index) =>
        String(question.id ?? index.toString())
      )
      .filter(Boolean)
  );

  const sanitized: Record<string, string> = {};

  for (const [questionId, value] of Object.entries(rawAnswers)) {
    if (!validQuestionIds.has(questionId)) {
      continue;
    }

    if (typeof value !== "string") {
      continue;
    }

    sanitized[questionId] = value.trim();
  }

  return sanitized;
};

/* =========================================================
   1. GET ALL EXAMS FOR LOGGED-IN STUDENT
========================================================= */

export const getMyExams = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = getStudentId(req);

    if (!userId) {
      res.status(401).json({
        status: "error",
        message: "Unauthorized",
      });
      return;
    }

    /* -----------------------------------------------------
       GET STUDENT BATCHES
    ----------------------------------------------------- */

    const memberships = await prisma.batchStudent.findMany({
      where: {
        studentId: userId,
      },
      select: {
        batchId: true,
      },
    });

    const myBatchIds = [
      ...new Set(
        memberships
          .map((membership) => membership.batchId)
          .filter(Boolean)
      ),
    ];

    /*
     * Student has no batch.
     */
    if (myBatchIds.length === 0) {
      res.json({
        status: "success",
        data: {
          exams: [],
        },
      });
      return;
    }

    /* -----------------------------------------------------
       GET EXAMS
    ----------------------------------------------------- */

    const exams = await prisma.exam.findMany({
      where: {
        batchId: {
          in: myBatchIds,
        },
      },

      include: {
        course: {
          select: {
            title: true,
          },
        },

        batch: {
          select: {
            name: true,
          },
        },

        results: {
          where: {
            studentId: userId,
          },

          select: {
            id: true,
            status: true,
            marksObtained: true,
            submittedAt: true,
          },

          take: 1,
        },
      },

      orderBy: [
        {
          createdAt: "desc",
        },
        {
          date: "desc",
        },
      ],
    });

    const now = new Date();

    const mappedExams = exams.map((exam) => {
      const result = exam.results[0];

      const { start: examStart, end: examEnd } =
        getExamWindow(
          exam.date,
          exam.durationMins
        );

      let studentStatus:
        | "Upcoming"
        | "LIVE"
        | "In Progress"
        | "Completed"
        | "Missed" = "Upcoming";

      /*
       * -----------------------------------------------
       * EXISTING ATTEMPT
       * -----------------------------------------------
       */

      if (result) {
        if (result.status === "IN_PROGRESS") {
          /*
           * If the exam time has already ended,
           * frontend may still be open. Treat it as
           * completed from student's dashboard.
           *
           * Actual finalization happens on submit/timeout.
           */
          if (now >= examEnd) {
            studentStatus = "Completed";
          } else {
            studentStatus = "In Progress";
          }
        } else {
          studentStatus = "Completed";
        }
      }

      /*
       * -----------------------------------------------
       * NO ATTEMPT YET
       * -----------------------------------------------
       */

      else {
        if (now < examStart) {
          studentStatus = "Upcoming";
        } else if (
          now >= examStart &&
          now < examEnd
        ) {
          studentStatus = "LIVE";
        } else {
          /*
           * Exam ended and student never started it.
           */
          studentStatus = "Missed";
        }
      }

      return {
        id: exam.id,
        examCode: exam.examCode,
        title: exam.title,
        category: exam.type || "THEORY",
        date: exam.date,
        createdAt: exam.createdAt,
        durationMins: exam.durationMins,
        totalMarks: exam.totalMarks,

        score:
          result &&
          result.marksObtained !== null
            ? `${result.marksObtained}/${exam.totalMarks}`
            : "--",

        status: studentStatus,

        resultId: result?.id || null,
      };
    });

    res.json({
      status: "success",
      data: {
        exams: mappedExams,
      },
    });
  } catch (error) {
    console.error(
      "Get My Exams Error:",
      error
    );

    res.status(500).json({
      status: "error",
      message: "Failed to fetch your exams.",
    });
  }
};

/* =========================================================
   2. GET SINGLE EXAM TO ATTEMPT

   IMPORTANT:
   First successful opening creates IN_PROGRESS record.

   This permanently locks the student's attempt.
========================================================= */

export const getExamToAttempt = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const examId = normalizeParam(req.params.id);
    const studentId = getStudentId(req);

    if (!studentId) {
      res.status(401).json({
        status: "error",
        message: "Unauthorized",
      });
      return;
    }

    if (!examId) {
      res.status(400).json({
        status: "error",
        message: "Invalid exam ID.",
      });
      return;
    }

    // ---------------------------------------------------------
    // 1. Check student eligibility
    // ---------------------------------------------------------
    const membership = await prisma.batchStudent.findFirst({
      where: {
        studentId,
        batch: {
          exams: {
            some: {
              id: examId,
            },
          },
        },
      },
      select: {
        id: true,
      },
    });

    if (!membership) {
      res.status(403).json({
        status: "error",
        message: "You are not eligible to attempt this exam.",
      });
      return;
    }

    // ---------------------------------------------------------
    // 2. Get exam
    // ---------------------------------------------------------
    const exam = await prisma.exam.findUnique({
      where: {
        id: examId,
      },
      select: {
        id: true,
        title: true,
        description: true,
        examCode: true,
        date: true,
        durationMins: true,
        totalMarks: true,
        passingMarks: true,
        type: true,
        questionsData: true,
      },
    });

    if (!exam) {
      res.status(404).json({
        status: "error",
        message: "Exam not found.",
      });
      return;
    }

    // ---------------------------------------------------------
    // 3. Check exam time
    // ---------------------------------------------------------
    const now = new Date();

    const { start: examStart, end: examEnd } = getExamWindow(
      exam.date,
      exam.durationMins
    );

    if (now < examStart) {
      res.status(403).json({
        status: "error",
        message: "Exam has not started yet.",
        data: {
          examStart: examStart.toISOString(),
          examEnd: examEnd.toISOString(),
        },
      });
      return;
    }

    if (now >= examEnd) {
      res.status(403).json({
        status: "error",
        message: "Exam time is over.",
        data: {
          examStart: examStart.toISOString(),
          examEnd: examEnd.toISOString(),
        },
      });
      return;
    }

    // ---------------------------------------------------------
    // 4. IMPORTANT:
    // First check existing attempt.
    // ---------------------------------------------------------
    let attempt = await prisma.examResult.findUnique({
      where: {
        examId_studentId: {
          examId,
          studentId,
        },
      },
    });

    // ---------------------------------------------------------
    // 5. Existing final result = NO REATTEMPT
    // ---------------------------------------------------------
    if (attempt && attempt.status !== "IN_PROGRESS") {
      res.status(403).json({
        status: "error",
        message:
          "You have already submitted this exam. A second attempt is not allowed.",
        data: {
          resultId: attempt.id,
          status: attempt.status,
        },
      });
      return;
    }

       // ---------------------------------------------------------
    // 6. No attempt = create ONE attempt
    // MongoDB's Prisma connector does NOT do a truly atomic
    // upsert (it's findFirst + create/update internally), so
    // concurrent requests can still race → P2002. Catch it and
    // re-fetch the record the other request created.
    // ---------------------------------------------------------
    if (!attempt) {
      try {
        attempt = await prisma.examResult.upsert({
          where: {
            examId_studentId: {
              examId,
              studentId,
            },
          },
          update: {}, // don't touch an existing record
          create: {
            examId,
            studentId,
            marksObtained: null,
            grade: null,
            status: "IN_PROGRESS",
            answersData: {},
            questionEvaluations: {},
            submittedAt: now,
          },
        });
      } catch (error: unknown) {
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error
            ? (error as { code?: string }).code
            : undefined;

        if (code !== "P2002") {
          throw error;
        }

        // Another concurrent request created it first — re-fetch.
        attempt = await prisma.examResult.findUnique({
          where: {
            examId_studentId: {
              examId,
              studentId,
            },
          },
        });

        if (!attempt) {
          res.status(409).json({
            status: "error",
            message:
              "Unable to initialize exam attempt. Please try again.",
          });
          return;
        }
      }

      if (attempt.status !== "IN_PROGRESS") {
        res.status(403).json({
          status: "error",
          message:
            "You have already submitted this exam. A second attempt is not allowed.",
          data: {
            resultId: attempt.id,
            status: attempt.status,
          },
        });
        return;
      }
    }

    // ---------------------------------------------------------
    // 7. Secure questions
    // NEVER send isCorrect to student during exam
    // ---------------------------------------------------------
    const questions = getQuestions(exam.questionsData);

    const secureQuestions = questions.map((question, index) => {
      const questionId = String(question.id ?? index);

      return {
        ...question,
        id: questionId,

        options: Array.isArray(question.options)
          ? question.options.map((option, optIndex) => ({
              id: String(option.id || `opt-${optIndex}`),
              text: String(option.text ?? ""),
            }))
          : [],
      };
    });

    // ---------------------------------------------------------
    // 8. Remaining time based on SERVER time
    // ---------------------------------------------------------
    const remainingSeconds = Math.max(
      0,
      Math.floor(
        (examEnd.getTime() - now.getTime()) / 1000
      )
    );

    res.json({
      status: "success",
      data: {
        attemptId: attempt.id,
        attemptStatus: attempt.status,

        exam: {
          ...exam,
          questionsData: secureQuestions,
        },

        examStart: examStart.toISOString(),
        examEnd: examEnd.toISOString(),
        remainingSeconds,
      },
    });
  } catch (error) {
    console.error("Get Exam To Attempt Error:", error);

    res.status(500).json({
      status: "error",
      message: "Failed to load exam.",
    });
  }
};

/* =========================================================
   3. SUBMIT EXAM
========================================================= */

export const submitExam = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const examId = normalizeParam(req.params.id);
    const studentId = getStudentId(req);

    if (!studentId) {
      res.status(401).json({
        status: "error",
        message: "Unauthorized",
      });
      return;
    }

    if (!examId) {
      res.status(400).json({
        status: "error",
        message: "Invalid exam ID.",
      });
      return;
    }

    const bodyAnswers =
      req.body?.answers ??
      req.body?.answersData ??
      {};

    // ---------------------------------------------------------
    // Get existing attempt
    // ---------------------------------------------------------
    const attempt = await prisma.examResult.findUnique({
      where: {
        examId_studentId: {
          examId,
          studentId,
        },
      },
      include: {
        exam: true,
      },
    });

    if (!attempt) {
      res.status(404).json({
        status: "error",
        message: "Exam attempt not found.",
      });
      return;
    }

    // ---------------------------------------------------------
    // Already submitted
    // ---------------------------------------------------------
    if (attempt.status !== "IN_PROGRESS") {
      res.status(403).json({
        status: "error",
        message:
          "This exam has already been submitted. A second attempt is not allowed.",
        data: {
          resultId: attempt.id,
          status: attempt.status,
        },
      });
      return;
    }

    const exam = attempt.exam;
    const now = new Date();

    const { start: examStart, end: examEnd } =
      getExamWindow(
        exam.date,
        exam.durationMins
      );

    // Student cannot submit before exam starts
    if (now < examStart) {
      res.status(403).json({
        status: "error",
        message: "Exam has not started yet.",
      });
      return;
    }

    // ---------------------------------------------------------
    // Questions from DATABASE
    // ---------------------------------------------------------
    const questions = getQuestions(
      exam.questionsData
    );

    // ---------------------------------------------------------
    // Sanitize submitted answers
    // ---------------------------------------------------------
    const answers = sanitizeAnswers(
      bodyAnswers,
      questions
    );

    const questionEvaluations: Record<
      string,
      QuestionEvaluation
    > = {};

    let marksObtained = 0;
    let hasSubjective = false;

    // ---------------------------------------------------------
    // SERVER SIDE SCORING
    // ---------------------------------------------------------
    for (
      let index = 0;
      index < questions.length;
      index++
    ) {
      const question = questions[index];

      const questionId = String(
        question.id ?? index
      );

      const maxMarks = Number(
        question.marks ?? 0
      );

      const submittedAnswer =
        answers[questionId] ?? "";

      const questionType =
        String(
          question.questionType ??
            "MCQ"
        ).toUpperCase();

      // =======================================================
      // MCQ
      // =======================================================
      if (
        questionType === "MCQ" ||
        questionType ===
          "MULTIPLE_CHOICE" ||
        questionType === "MULTIPLE CHOICE" ||
        questionType === "SINGLE_CHOICE"
      ) {
        const rawOptions = Array.isArray(
          question.options
        )
          ? question.options
          : [];

        // Assign fallback IDs consistent with
        // what getExamToAttempt sends to client
        const options = rawOptions.map(
          (option, optIndex) => ({
            ...option,
            id: String(
              option.id || `opt-${optIndex}`
            ),
          })
        );

        const correctOption =
          options.find(
            (option) =>
              option.isCorrect === true
          );

        const selectedOption =
          options.find(
            (option) =>
              String(option.id) ===
              String(submittedAnswer)
          );

        // No answer
        if (!submittedAnswer) {
          questionEvaluations[
            questionId
          ] = {
            marks: 0,
            maxMarks,
            status: "UNANSWERED",
            feedback: "",
            selectedAnswer: null,
            correctAnswer: correctOption
              ? String(
                  correctOption.text ?? ""
                )
              : null,
          };

          continue;
        }

        // Correct
        if (
          correctOption &&
          selectedOption &&
          String(
            selectedOption.id
          ) ===
            String(correctOption.id)
        ) {
          marksObtained += maxMarks;

          questionEvaluations[
            questionId
          ] = {
            marks: maxMarks,
            maxMarks,
            status: "CORRECT",
            feedback: "",
            selectedAnswer: String(
              selectedOption.text ?? ""
            ),
            correctAnswer: String(
              correctOption.text ?? ""
            ),
          };
        }

        // Incorrect
        else {
          questionEvaluations[
            questionId
          ] = {
            marks: 0,
            maxMarks,
            status: "INCORRECT",
            feedback: "",
            selectedAnswer: selectedOption
              ? String(
                  selectedOption.text ?? ""
                )
              : submittedAnswer,
            correctAnswer: correctOption
              ? String(
                  correctOption.text ?? ""
                )
              : null,
          };
        }

        continue;
      }

      // =======================================================
      // SUBJECTIVE / LONG ANSWER
      // =======================================================
      if (
        questionType === "SUBJECTIVE" ||
        questionType === "LONG_TEXT" ||
        questionType === "LONG TEXT" ||
        questionType === "TEXT" ||
        questionType === "DESCRIPTIVE"
      ) {
        hasSubjective = true;

        questionEvaluations[
          questionId
        ] = {
          marks: 0,
          maxMarks,
          status: submittedAnswer
            ? "PENDING"
            : "UNANSWERED",
          feedback: "",
        };

        continue;
      }

      // =======================================================
      // UNKNOWN TYPE
      // =======================================================
      questionEvaluations[
        questionId
      ] = {
        marks: 0,
        maxMarks,
        status: submittedAnswer
          ? "PENDING"
          : "UNANSWERED",
        feedback: "",
      };
    }

    // ---------------------------------------------------------
    // Final status
    // ---------------------------------------------------------
    let finalStatus: string;

    if (hasSubjective) {
      finalStatus = "PENDING";
    } else {
      finalStatus =
        marksObtained >=
        Number(exam.passingMarks)
          ? "PASS"
          : "FAIL";
    }

    // ---------------------------------------------------------
    // IMPORTANT:
    // UPDATE EXISTING RESULT
    // NEVER CREATE HERE
    // ---------------------------------------------------------
    const result =
      await prisma.examResult.update({
        where: {
          id: attempt.id,
        },

        data: {
          answersData:
            answers as Prisma.InputJsonValue,

          marksObtained,

          questionEvaluations:
            questionEvaluations as unknown as Prisma.InputJsonValue,

          status: finalStatus,

          submittedAt: now,
        },
      });

    res.json({
      status: "success",
      message: "Exam submitted successfully.",
      data: {
        resultId: result.id,
        marksObtained: result.marksObtained,
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        status: result.status,
        questionEvaluations,
      },
    });
  } catch (error) {
    console.error(
      "Submit Exam Error:",
      error
    );

    res.status(500).json({
      status: "error",
      message: "Failed to submit exam.",
    });
  }
};

/* =========================================================
   4. GET STUDENT RESULT DETAILS
========================================================= */

export const getMyResultDetails = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const resultId = normalizeParam(
      req.params.resultId
    );

    const studentId = getStudentId(req);

    if (!studentId) {
      res.status(401).json({
        status: "error",
        message: "Unauthorized",
      });
      return;
    }

    if (!resultId) {
      res.status(400).json({
        status: "error",
        message: "Invalid result ID.",
      });
      return;
    }

    /* -----------------------------------------------------
       GET RESULT
    ----------------------------------------------------- */

    const result =
      await prisma.examResult.findUnique({
        where: {
          id: resultId,
        },

        include: {
          exam: {
            select: {
              id: true,
              title: true,
              type: true,
              totalMarks: true,
              passingMarks: true,
              questionsData: true,
              date: true,
              durationMins: true,
            },
          },
        },
      });

    /* -----------------------------------------------------
       SECURITY
    ----------------------------------------------------- */

    if (
      !result ||
      result.studentId !== studentId
    ) {
      res.status(404).json({
        status: "error",
        message:
          "Result not found or unauthorized.",
      });
      return;
    }

    /* -----------------------------------------------------
       PERCENTILE

       Only FINAL evaluated/submitted results
       should participate.

       IN_PROGRESS is excluded.
    ----------------------------------------------------- */

    let percentile: number | null = null;

    const resultIsFinal =
      result.status !== "IN_PROGRESS";

    if (resultIsFinal) {
      const studentMarks =
        result.marksObtained ?? 0;

      const totalAttempts =
        await prisma.examResult.count({
          where: {
            examId: result.examId,

            status: {
              not: "IN_PROGRESS",
            },

            marksObtained: {
              not: null,
            },
          },
        });

      if (totalAttempts > 0) {
        const belowOrEqualCount =
          await prisma.examResult.count({
            where: {
              examId: result.examId,

              status: {
                not: "IN_PROGRESS",
              },

              marksObtained: {
                not: null,
                lte: studentMarks,
              },
            },
          });

        percentile = Number(
          (
            (belowOrEqualCount /
              totalAttempts) *
            100
          ).toFixed(1)
        );
      }
    }

    /* -----------------------------------------------------
       RETURN RESULT
    ----------------------------------------------------- */

    const finalResult = {
      ...result,

      percentile,
    };

    res.json({
      status: "success",

      data: {
        result: finalResult,
      },
    });
  } catch (error) {
    console.error(
      "Get Result Details Error:",
      error
    );

    res.status(500).json({
      status: "error",
      message:
        "Failed to load result details.",
    });
  }
};