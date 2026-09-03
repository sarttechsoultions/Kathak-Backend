import { Request, Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/* ============================================================
   TYPES
============================================================ */

type RuntimeExamStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "LIVE"
  | "COMPLETED";

type ExamListItem = {
  id: string;
  title: string;
  examCode: string;
  type: string;
  date: Date;
  durationMins: number;
  totalMarks: number;
  passingMarks: number;
  status: RuntimeExamStatus;
  courseId: string | null;
  courseName: string;
  batchId: string | null;
  batchName: string;
  createdBy: {
    id: string;
    fullName: string;
    email: string;
  } | null;
  resultCount: number;
};

type ExamStudentItem = {
  studentId: string;
  studentName: string;
  studentEmail: string;
  resultId: string | null;
  marksObtained: number | null;
  totalMarks: number;
  passingMarks: number;
  percentage: number | null;
  status: string;
  grade: string | null;
  feedback: string | null;
  submittedAt: Date | null;
};

/* ============================================================
   HELPERS
============================================================ */

/**
 * Get all batches assigned to a teacher.
 *
 * Supports:
 * 1. Batch.teacherId
 * 2. User.batchesAsTeacher relation
 */
const getTeacherBatchIds = async (
  userId: string
): Promise<string[]> => {
  const [
    batchesByTeacherId,
    teacherUser,
  ] = await Promise.all([
    prisma.batch.findMany({
      where: {
        teacherId: userId,
      },
      select: {
        id: true,
      },
    }),

    prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        batchesAsTeacher: {
          select: {
            id: true,
          },
        },
      },
    }),
  ]);

  const ids = new Set<string>();

  for (const batch of batchesByTeacherId) {
    ids.add(batch.id);
  }

  for (const batch of (
    teacherUser?.batchesAsTeacher ?? []
  )) {
    ids.add(batch.id);
  }

  return Array.from(ids);
};

/**
 * Check Teacher role.
 */
const isTeacher = (
  user: NonNullable<Request["user"]>
): boolean => {
  return (
    String(user.role).toUpperCase() ===
    "TEACHER"
  );
};

/**
 * Check Admin role.
 */
const isAdmin = (
  user: NonNullable<Request["user"]>
): boolean => {
  return (
    String(user.role).toUpperCase() ===
    "ADMIN"
  );
};

/**
 * Safely parse number.
 */
const parseNumber = (
  value: unknown,
  fallback: number
): number => {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
};

/**
 * Calculate percentage.
 */
const calculatePercentage = (
  marks: number,
  totalMarks: number
): number => {
  if (totalMarks <= 0) {
    return 0;
  }

  return Number(
    ((marks / totalMarks) * 100).toFixed(2)
  );
};

/* ============================================================
   GET EXAMS
   GET /admin/exams
============================================================ */

export const getExams = async (
    req: Request,
    res: Response
) => {
    try {
        const user = req.user;

        if (!user) {
            return res.status(401).json({
                success: false,
                message:
                    "Authentication required.",
            });
        }

        const userRole = String(
            user.role
        ).toUpperCase();

        const isAdmin =
            userRole === "ADMIN";

        const isTeacher =
            userRole === "TEACHER";

        // =====================================================
        // TEACHER BATCH IDS
        // =====================================================

        const getTeacherBatchIds =
            async (
                userId: string
            ): Promise<string[]> => {
                const [
                    byTeacherId,
                    teacherData,
                ] = await Promise.all([
                    prisma.batch.findMany({
                        where: {
                            teacherId:
                                userId,
                        },
                        select: {
                            id: true,
                        },
                    }),

                    prisma.user.findUnique({
                        where: {
                            id: userId,
                        },
                        select: {
                            batchesAsTeacher:
                                {
                                    select: {
                                        id: true,
                                    },
                                },
                        },
                    }),
                ]);

                const ids =
                    new Set<string>();

                byTeacherId.forEach(
                    (batch) => {
                        ids.add(
                            batch.id
                        );
                    }
                );

                teacherData?.batchesAsTeacher?.forEach(
                    (batch) => {
                        ids.add(
                            batch.id
                        );
                    }
                );

                return Array.from(
                    ids
                );
            };

        // =====================================================
        // WHERE
        // =====================================================

        const where: Prisma.ExamWhereInput =
            {};

        if (isTeacher) {
            const teacherBatchIds =
                await getTeacherBatchIds(
                    user.id
                );

            where.batchId = {
                in: teacherBatchIds,
            };
        }

        // Admin sees everything.

        // =====================================================
        // FETCH EXAMS
        // =====================================================

        const exams =
            await prisma.exam.findMany({
                where,

                include: {
                    course: {
                        select: {
                            id: true,
                            title: true,
                        },
                    },

                    batch: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            courseId:
                                true,
                        },
                    },

                    createdBy: {
                        select: {
                            id: true,
                            fullName:
                                true,
                            email: true,
                        },
                    },

                    _count: {
                        select: {
                            results: true,
                        },
                    },
                },

                orderBy: {
                    date: "desc",
                },
            });

        // =====================================================
        // CURRENT TIME
        // =====================================================

        const now =
            new Date();

        // =====================================================
        // RUNTIME STATUS
        // =====================================================
        //
        // IMPORTANT:
        // We DO NOT save LIVE / COMPLETED to Prisma.
        //
        // Prisma DB remains:
        //
        // SCHEDULED
        //
        // Runtime response becomes:
        //
        // SCHEDULED
        // LIVE
        // COMPLETED
        //
        // based on current time.
        // =====================================================

        const examsWithRuntimeStatus =
            exams.map(
                (exam) => {
                    const startTime =
                        new Date(
                            exam.date
                        );

                    const duration =
                        Number(
                            exam.durationMins ||
                                120
                        );

                    const endTime =
                        new Date(
                            startTime.getTime() +
                                duration *
                                    60 *
                                    1000
                        );

                    let runtimeStatus:
                        | "SCHEDULED"
                        | "LIVE"
                        | "COMPLETED";

                    if (
                        now <
                        startTime
                    ) {
                        runtimeStatus =
                            "SCHEDULED";
                    } else if (
                        now >=
                            startTime &&
                        now <
                            endTime
                    ) {
                        runtimeStatus =
                            "LIVE";
                    } else {
                        runtimeStatus =
                            "COMPLETED";
                    }

                    return {
                        id: exam.id,

                        examCode:
                            exam.examCode,

                        title:
                            exam.title,

                        description:
                            exam.description,

                        type:
                            exam.type,

                        date:
                            exam.date,

                        durationMins:
                            exam.durationMins,

                        totalMarks:
                            exam.totalMarks,

                        passingMarks:
                            exam.passingMarks,

                        // Runtime status
                        status:
                            runtimeStatus,

                        // Useful IDs
                        courseId:
                            exam.courseId,

                        batchId:
                            exam.batchId,

                        // Display names
                        courseName:
                            exam.course
                                ?.title ||
                            "All Courses",

                        batchName:
                            exam.batch
                                ?.name ||
                            "All Batches",

                        createdAt:
                            exam.createdAt,

                        updatedAt:
                            exam.updatedAt,

                        createdBy:
                            exam.createdBy,

                        resultCount:
                            exam._count
                                .results,
                    };
                }
            );

        // =====================================================
        // STATISTICS
        // =====================================================

        const totalExams =
            examsWithRuntimeStatus.length;

        const liveExams =
            examsWithRuntimeStatus.filter(
                (exam) =>
                    exam.status ===
                    "LIVE"
            ).length;

        const scheduledExams =
            examsWithRuntimeStatus.filter(
                (exam) =>
                    exam.status ===
                    "SCHEDULED"
            ).length;

        const completedExams =
            examsWithRuntimeStatus.filter(
                (exam) =>
                    exam.status ===
                    "COMPLETED"
            ).length;

        // =====================================================
        // RESPONSE
        // =====================================================

        return res.status(200).json({
            success: true,

            data: {
                exams:
                    examsWithRuntimeStatus,

                stats: {
                    totalExams,
                    liveExams,
                    scheduledExams,
                    completedExams,
                },
            },
        });
    } catch (error) {
        console.error(
            "Get exams error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error instanceof Error
                    ? error.message
                    : "Failed to fetch exams.",
        });
    }
};

/* ============================================================
   CREATE EXAM
   POST /admin/exams

   ADMIN + TEACHER SAME LOGIC

   passingPercentage:
      40

   totalMarks:
      15

   Database:
      passingMarks = 6
============================================================ */

export const createExam = async (
    req: Request,
    res: Response
) => {
    try {
        const user = req.user;

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required.",
            });
        }

        const {
            title,
            description,
            examCode,
            type,
            date,
            durationMins,
            totalMarks,
            passingPercentage,
            passingMarks,

            courseId,
            batchIds,

            // Admin bulk options
            allCourses,
            allBatches,

            questions,
            autoGrading,
            randomizeQuestions,
            status,
        } = req.body;

        const userRole = String(
            user.role
        ).toUpperCase();

        const isAdmin =
            userRole === "ADMIN";

        const isTeacher =
            userRole === "TEACHER";

        // =====================================================
        // BASIC VALIDATION
        // =====================================================

        if (!title?.trim()) {
            return res.status(400).json({
                success: false,
                message:
                    "Exam title is required.",
            });
        }

        if (!date) {
            return res.status(400).json({
                success: false,
                message:
                    "Exam date is required.",
            });
        }

        const parsedTotalMarks =
            Number(totalMarks);

        if (
            !Number.isFinite(
                parsedTotalMarks
            ) ||
            parsedTotalMarks <= 0
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Total marks must be greater than 0.",
            });
        }

        const parsedDuration =
            Number(durationMins);

        if (
            !Number.isFinite(
                parsedDuration
            ) ||
            parsedDuration <= 0
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Duration must be greater than 0.",
            });
        }

        // =====================================================
        // PASSING SCORE
        // =====================================================

        let finalPassingMarks: number;

        if (
            passingPercentage !==
                undefined &&
            passingPercentage !== null &&
            passingPercentage !== ""
        ) {
            const parsedPercentage =
                Number(
                    passingPercentage
                );

            if (
                !Number.isFinite(
                    parsedPercentage
                ) ||
                parsedPercentage < 1 ||
                parsedPercentage > 100
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Passing percentage must be between 1 and 100.",
                });
            }

            finalPassingMarks =
                Number(
                    (
                        (parsedTotalMarks *
                            parsedPercentage) /
                        100
                    ).toFixed(2)
                );
        } else {
            // Backward compatibility
            finalPassingMarks =
                Number(passingMarks);

            if (
                !Number.isFinite(
                    finalPassingMarks
                ) ||
                finalPassingMarks <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Passing score is required.",
                });
            }
        }

        if (
            finalPassingMarks >
            parsedTotalMarks
        ) {
            return res.status(400).json({
                success: false,
                message: `Passing marks (${finalPassingMarks}) cannot be greater than total marks (${parsedTotalMarks}).`,
            });
        }

        // =====================================================
        // GET TEACHER BATCHES
        // =====================================================

        const getTeacherBatchIds =
            async (
                userId: string
            ): Promise<string[]> => {
                const [
                    byTeacherId,
                    teacherData,
                ] = await Promise.all([
                    prisma.batch.findMany({
                        where: {
                            teacherId:
                                userId,
                        },
                        select: {
                            id: true,
                        },
                    }),

                    prisma.user.findUnique({
                        where: {
                            id: userId,
                        },
                        select: {
                            batchesAsTeacher:
                                {
                                    select: {
                                        id: true,
                                    },
                                },
                        },
                    }),
                ]);

                const ids =
                    new Set<string>();

                byTeacherId.forEach(
                    (batch) =>
                        ids.add(
                            batch.id
                        )
                );

                teacherData?.batchesAsTeacher?.forEach(
                    (batch) =>
                        ids.add(
                            batch.id
                        )
                );

                return Array.from(
                    ids
                );
            };

        const teacherBatchIds =
            isTeacher
                ? await getTeacherBatchIds(
                      user.id
                  )
                : [];

        // =====================================================
        // RESOLVE TARGET BATCHES
        // =====================================================

        let targetBatches: Array<{
            id: string;
            courseId: string | null;
        }> = [];

        // =====================================================
        // ADMIN - ALL COURSES
        // =====================================================

        if (
            isAdmin &&
            allCourses === true
        ) {
            const allBatchRecords =
                await prisma.batch.findMany(
                    {
                        where: {
                            courseId: {
                                not: null,
                            },
                        },
                        select: {
                            id: true,
                            courseId: true,
                        },
                    }
                );

            targetBatches =
                allBatchRecords;
        }

        // =====================================================
        // SPECIFIC COURSE
        // =====================================================

        else {
            if (
                typeof courseId !==
                    "string" ||
                !courseId
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Course is required.",
                });
            }

            // -------------------------------------------------
            // ALL BATCHES OF SPECIFIC COURSE
            // -------------------------------------------------

            if (
                allBatches === true
            ) {
                const courseBatches =
                    await prisma.batch.findMany(
                        {
                            where: {
                                courseId:
                                    courseId,
                            },
                            select: {
                                id: true,
                                courseId:
                                    true,
                            },
                        }
                    );

                targetBatches =
                    courseBatches;
            }

            // -------------------------------------------------
            // SELECTED BATCHES
            // -------------------------------------------------

            else {
                const rawBatchIds =
                    Array.isArray(
                        batchIds
                    )
                        ? batchIds
                        : [];

                const uniqueBatchIds =
                    Array.from(
                        new Set(
                            rawBatchIds
                                .map(
                                    (
                                        id
                                    ) =>
                                        String(
                                            id
                                        )
                                )
                                .filter(
                                    Boolean
                                )
                        )
                    );

                if (
                    uniqueBatchIds.length ===
                    0
                ) {
                    return res
                        .status(400)
                        .json({
                            success:
                                false,
                            message:
                                "At least one batch is required.",
                        });
                }

                const selectedBatches =
                    await prisma.batch.findMany(
                        {
                            where: {
                                id: {
                                    in: uniqueBatchIds,
                                },
                            },
                            select: {
                                id: true,
                                courseId:
                                    true,
                            },
                        }
                    );

                // -------------------------------------------------
                // CHECK ALL BATCHES EXIST
                // -------------------------------------------------

                if (
                    selectedBatches.length !==
                    uniqueBatchIds.length
                ) {
                    const foundIds =
                        new Set(
                            selectedBatches.map(
                                (
                                    batch
                                ) =>
                                    batch.id
                            )
                        );

                    const missingIds =
                        uniqueBatchIds.filter(
                            (
                                id
                            ) =>
                                !foundIds.has(
                                    id
                                )
                        );

                    return res
                        .status(400)
                        .json({
                            success:
                                false,
                            message:
                                `Some selected batches were not found: ${missingIds.join(", ")}`,
                        });
                }

                // -------------------------------------------------
                // COURSE / BATCH VALIDATION
                // -------------------------------------------------

                const mismatchedBatches =
                    selectedBatches.filter(
                        (
                            batch
                        ) =>
                            batch.courseId !==
                            courseId
                    );

                if (
                    mismatchedBatches.length >
                    0
                ) {
                    return res
                        .status(400)
                        .json({
                            success:
                                false,
                            message:
                                "One or more selected batches do not belong to the selected course.",
                        });
                }

                targetBatches =
                    selectedBatches;
            }
        }

        // =====================================================
        // TEACHER PERMISSION
        // =====================================================

        if (isTeacher) {
            const allowedBatchIds =
                new Set(
                    teacherBatchIds
                );

            const unauthorizedBatches =
                targetBatches.filter(
                    (
                        batch
                    ) =>
                        !allowedBatchIds.has(
                            batch.id
                        )
                );

            if (
                unauthorizedBatches.length >
                0
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You can create exams only for your assigned batches.",
                });
            }
        }

        // =====================================================
        // MUST HAVE TARGET BATCHES
        // =====================================================

        if (
            targetBatches.length ===
            0
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "No valid batches found for this exam.",
            });
        }

        // =====================================================
        // CREATE UNIQUE EXAM CODE
        // =====================================================

        const makeExamCode =
            async (
                baseCode?: string
            ) => {
                const base =
                    String(
                        baseCode ||
                            `EX-${new Date().getFullYear()}`
                    )
                        .trim()
                        .replace(
                            /\s+/g,
                            "-"
                        )
                        .toUpperCase();

                let code = `${base}-${Math.floor(
                    100000 +
                        Math.random() *
                            900000
                )}`;

                let exists =
                    await prisma.exam.findUnique(
                        {
                            where: {
                                examCode:
                                    code,
                            },
                            select: {
                                id: true,
                            },
                        }
                    );

                while (exists) {
                    code = `${base}-${Math.floor(
                        100000 +
                            Math.random() *
                                900000
                    )}`;

                    exists =
                        await prisma.exam.findUnique(
                            {
                                where: {
                                    examCode:
                                        code,
                                },
                                select: {
                                    id: true,
                                },
                            }
                        );
                }

                return code;
            };

        // =====================================================
        // STATUS
        // =====================================================
        //
        // Current Prisma ExamStatus does NOT contain DRAFT.
        // Therefore we always save SCHEDULED.
        //
        // Runtime LIVE / COMPLETED can be calculated in GET.
        // =====================================================

        const finalStatus =
            "SCHEDULED";

        // =====================================================
        // CREATE ONE EXAM PER BATCH
        // =====================================================

        const createdExams =
            [];

        for (
            const batch of targetBatches
        ) {
            const code =
                await makeExamCode(
                    examCode
                );

            const exam =
                await prisma.exam.create(
                    {
                        data: {
                            title:
                                title.trim(),

                            description:
                                description
                                    ? String(
                                          description
                                      )
                                    : null,

                            examCode:
                                code,

                            ...(type
                                ? {
                                      type: type,
                                  }
                                : {}),

                            date:
                                new Date(
                                    date
                                ),

                            durationMins:
                                Math.round(
                                    parsedDuration
                                ),

                            totalMarks:
                                parsedTotalMarks,

                            passingMarks:
                                finalPassingMarks,

                            status:
                                finalStatus,

                            questionsData:
                                questions ??
                                null,

                            batchId:
                                batch.id,

                            courseId:
                                batch.courseId,

                            createdById:
                                user.id,
                        },
                    }
                );

            createdExams.push(
                exam
            );
        }

        // =====================================================
        // RESPONSE
        // =====================================================

        return res.status(201).json({
            success: true,

            message: `Exam created successfully for ${createdExams.length} batch${
                createdExams.length ===
                1
                    ? ""
                    : "es"
            }.`,
            
            data: {
                exams: createdExams,
                count: createdExams.length,
                totalMarks:
                    parsedTotalMarks,
                passingMarks:
                    finalPassingMarks,
                passingPercentage:
                    passingPercentage !==
                    undefined
                        ? Number(
                              passingPercentage
                          )
                        : Number(
                              (
                                  (finalPassingMarks /
                                      parsedTotalMarks) *
                                  100
                              ).toFixed(2)
                          ),
            },
        });
    } catch (error) {
        console.error(
            "Create exam error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error instanceof Error
                    ? error.message
                    : "Failed to create exam.",
        });
    }
};
/* ============================================================
   GET EXAM RESULTS
   GET /admin/exams/results
============================================================ */

export const getExamResults =
  async (
    req: Request,
    res: Response
  ) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      let where: Prisma.ExamResultWhereInput =
        {};

      /* ------------------------------------------------------
         TEACHER → OWN BATCHES
      ------------------------------------------------------ */

      if (isTeacher(user)) {
        const teacherBatchIds =
          await getTeacherBatchIds(
            user.id
          );

        if (
          teacherBatchIds.length ===
          0
        ) {
          return res.json({
            success: true,
            data: [],
          });
        }

        where = {
          exam: {
            batchId: {
              in: teacherBatchIds,
            },
          },
        };
      }

      /* ------------------------------------------------------
         FETCH RESULTS
      ------------------------------------------------------ */

      const results =
        await prisma.examResult.findMany(
          {
            where,

            include: {
              exam: {
                include: {
                  course: {
                    select: {
                      id: true,
                      title: true,
                    },
                  },

                  batch: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                    },
                  },
                },
              },

              student: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                },
              },
            },

            orderBy: {
              submittedAt:
                "desc",
            },
          }
        );

      /* ------------------------------------------------------
         FORMAT
      ------------------------------------------------------ */

      const data =
        results.map(
          (result) => {
            const totalMarks =
              Number(
                result.exam
                  .totalMarks
              );

            const marksObtained =
              result.marksObtained !==
                  null &&
                result.marksObtained !==
                  undefined
                ? Number(
                    result.marksObtained
                  )
                : null;

            const passingMarks =
              Number(
                result.exam
                  .passingMarks
              );

            const percentage =
              marksObtained !==
                  null &&
                totalMarks > 0
                ? calculatePercentage(
                    marksObtained,
                    totalMarks
                  )
                : null;

            /*
             * Backend decides pass/fail
             * from marks.
             */
            const resultStatus =
              marksObtained !==
                null
                ? marksObtained >=
                  passingMarks
                  ? "PASSED"
                  : "FAILED"
                : String(
                    result.status
                  );

            return {
              id:
                result.id,

              studentId:
                result.studentId,

              studentName:
                result.student
                  .fullName,

              studentEmail:
                result.student
                  .email,

              examId:
                result.examId,

              examTitle:
                result.exam
                  .title,

              examCode:
                result.exam
                  .examCode,

              courseId:
                result.exam
                  .courseId,

              courseName:
                result.exam
                  .course?.title ??
                "Unknown Course",

              batchId:
                result.exam
                  .batchId,

              batchName:
                result.exam
                  .batch?.name ??
                "Unknown Batch",

              totalMarks,

              passingMarks,

              marksObtained,

              percentage,

              status:
                resultStatus,

              grade:
                result.grade,

              feedback:
                result.feedback,

              fileUrl:
                result.fileUrl,

              submittedAt:
                result.submittedAt,

              flagged:
                result.flagged,

              answersData:
                result.answersData,

              questionEvaluations:
                result.questionEvaluations,
            };
          }
        );

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error(
        "getExamResults error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to fetch exam results",
      });
    }
  };

/* ============================================================
   EVALUATE EXAM RESULT
   POST /admin/exams/results/:id/evaluate
============================================================ */

export const evaluateExamResult =
  async (
    req: Request,
    res: Response
  ) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      /*
       * Force params value to string.
       *
       * Prevents:
       * string | string[]
       *
       * type error.
       */
      const resultId =
        String(
          req.params.id
        );

      const {
        finalMarks,
        marksObtained,
        grade,
        feedback,
        questionEvaluations,
        flagged,
      } = req.body;

      /*
       * Support both:
       *
       * finalMarks
       * marksObtained
       *
       * But database uses:
       * marksObtained
       */
      const submittedMarks =
        finalMarks !==
          undefined
          ? finalMarks
          : marksObtained;

      if (
        submittedMarks ===
          undefined ||
        submittedMarks ===
          null ||
        submittedMarks ===
          ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Marks obtained are required",
        });
      }

      /* ------------------------------------------------------
         FIND RESULT
      ------------------------------------------------------ */

      const result =
        await prisma.examResult.findUnique(
          {
            where: {
              id:
                resultId,
            },

            include: {
              exam: {
                select: {
                  id: true,
                  totalMarks: true,
                  passingMarks: true,
                  batchId: true,
                },
              },
            },
          }
        );

      if (!result) {
        return res.status(404).json({
          success: false,
          message:
            "Exam result not found",
        });
      }

      /* ------------------------------------------------------
         TEACHER AUTHORIZATION
      ------------------------------------------------------ */

      if (isTeacher(user)) {
        const teacherBatchIds =
          await getTeacherBatchIds(
            user.id
          );

        if (
          !result.exam.batchId ||
          !teacherBatchIds.includes(
            result.exam.batchId
          )
        ) {
          return res.status(403).json({
            success: false,
            message:
              "You are not authorized to evaluate this exam result",
          });
        }
      }

      /* ------------------------------------------------------
         MARKS
      ------------------------------------------------------ */

      const parsedMarks =
        Number(
          submittedMarks
        );

      const totalMarks =
        Number(
          result.exam
            .totalMarks
        );

      const passingMarks =
        Number(
          result.exam
            .passingMarks
        );

      if (
        !Number.isFinite(
          parsedMarks
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid marks obtained",
        });
      }

      if (
        parsedMarks < 0 ||
        parsedMarks >
          totalMarks
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Marks must be between 0 and ${totalMarks}`,
        });
      }

      /* ------------------------------------------------------
         PASS / FAIL
      ------------------------------------------------------ */

      const calculatedStatus =
        parsedMarks >=
        passingMarks
          ? "PASSED"
          : "FAILED";

      /* ------------------------------------------------------
         UPDATE
      ------------------------------------------------------ */

      const updatedResult =
        await prisma.examResult.update(
          {
            where: {
              id:
                resultId,
            },

            data: {
              marksObtained:
                parsedMarks,

              grade:
                grade !==
                undefined
                  ? grade
                  : null,

              feedback:
                feedback !==
                undefined
                  ? feedback
                  : null,

              questionEvaluations:
                questionEvaluations !==
                undefined
                  ? questionEvaluations
                  : undefined,

              flagged:
                flagged !==
                undefined
                  ? Boolean(
                      flagged
                    )
                  : undefined,

              status:
                calculatedStatus,
            },
          }
        );

      const percentage =
        calculatePercentage(
          parsedMarks,
          totalMarks
        );

      return res.json({
        success: true,

        message:
          "Exam result evaluated successfully",

        data: {
          id:
            updatedResult.id,

          marksObtained:
            parsedMarks,

          totalMarks,

          passingMarks,

          percentage,

          status:
            calculatedStatus,

          grade:
            updatedResult.grade,

          feedback:
            updatedResult.feedback,

          flagged:
            updatedResult.flagged,

          submittedAt:
            updatedResult.submittedAt,
        },
      });
    } catch (error) {
      console.error(
        "evaluateExamResult error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to evaluate exam result",
      });
    }
  };

/* ============================================================
   GET EXAM STUDENTS
   GET /admin/exams/:id/students
============================================================ */

export const getExamStudents = async (
  req: Request,
  res: Response
) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const examId = String(req.params.id);

    /* ------------------------------------------------------
       FIND EXAM
    ------------------------------------------------------ */

    const exam = await prisma.exam.findUnique({
      where: {
        id: examId,
      },

      include: {
        batch: {
          select: {
            id: true,
            name: true,
            code: true,

            students: {
              include: {
                student: {
                  select: {
                    id: true,
                    fullName: true,
                    email: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },

        course: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: "Exam not found",
      });
    }

    /* ------------------------------------------------------
       TEACHER AUTHORIZATION
    ------------------------------------------------------ */

    if (isTeacher(user)) {
      const teacherBatchIds = await getTeacherBatchIds(user.id);

      if (
        !exam.batchId ||
        !teacherBatchIds.includes(exam.batchId)
      ) {
        return res.status(403).json({
          success: false,
          message:
            "You are not authorized to view students for this exam",
        });
      }
    }

    /* ------------------------------------------------------
       EXAM TIMING
    ------------------------------------------------------ */

    const examStartTime = new Date(exam.date);

    const examEndTime = new Date(
      examStartTime.getTime() +
        Number(exam.durationMins || 0) * 60 * 1000
    );

    const now = new Date();

    const examStarted = now >= examStartTime;

    const examCompleted = now >= examEndTime;

    /* ------------------------------------------------------
       STUDENTS FROM TARGET BATCH
    ------------------------------------------------------ */

    const students =
      exam.batch?.students.map((membership) => ({
        id: membership.student.id,
        fullName: membership.student.fullName,
        email: membership.student.email,
        avatarUrl: membership.student.avatarUrl,
      })) ?? [];

    /* ------------------------------------------------------
       RESULTS
    ------------------------------------------------------ */

    const results = await prisma.examResult.findMany({
      where: {
        examId: exam.id,
      },

      select: {
        id: true,
        studentId: true,
        marksObtained: true,
        status: true,
        grade: true,
        feedback: true,
        submittedAt: true,
        flagged: true,
      },

      orderBy: {
        submittedAt: "desc",
      },
    });

    /* ------------------------------------------------------
       RESULT MAP
    ------------------------------------------------------ */

    const resultMap = new Map<
      string,
      (typeof results)[number]
    >();

    for (const result of results) {
      resultMap.set(result.studentId, result);
    }

    /* ------------------------------------------------------
       FORMAT STUDENTS
    ------------------------------------------------------ */

    const data = students.map((student) => {
      const result = resultMap.get(student.id);

      const marksObtained =
        result?.marksObtained !== null &&
        result?.marksObtained !== undefined
          ? Number(result.marksObtained)
          : null;

      const totalMarks = Number(exam.totalMarks);

      const passingMarks = Number(exam.passingMarks);

      const percentage =
        marksObtained !== null && totalMarks > 0
          ? calculatePercentage(
              marksObtained,
              totalMarks
            )
          : null;

      /* ----------------------------------------------------
         STATUS LOGIC

         1. Marks available
            => Passed / Failed

         2. Result exists but marks unavailable
            => Pending

         3. No result + exam completed
            => Absent

         4. No result + exam not completed
            => Pending
      ---------------------------------------------------- */

      let status:
        | "Passed"
        | "Failed"
        | "Pending"
        | "Absent";

      if (marksObtained !== null) {
        status =
          marksObtained >= passingMarks
            ? "Passed"
            : "Failed";
      } else if (result) {
        // Student has a result/submission record
        // but marks have not been evaluated yet.
        status = "Pending";
      } else if (examCompleted) {
        // Exam is over and student has NO result.
        status = "Absent";
      } else {
        // Exam has not finished yet.
        status = "Pending";
      }

      /* ----------------------------------------------------
         SCORE
      ---------------------------------------------------- */

      const score =
        marksObtained !== null
          ? `${marksObtained}/${totalMarks}`
          : "--";

      return {
        /*
         * Keep both id and studentId for frontend
         * compatibility.
         */
        id: student.id,
        studentId: student.id,

        studentName: student.fullName,

        studentEmail: student.email,

        studentAvatar:
          student.avatarUrl ?? "",

        /*
         * Your current User model does not have a
         * separate studentIdCode field.
         *
         * So don't invent one here.
         */
        studentIdCode: student.id,

        /*
         * IMPORTANT:
         * This was missing earlier.
         */
        batchName:
          exam.batch?.name ??
          "Unknown Batch",

        batchId:
          exam.batchId ?? null,

        resultId:
          result?.id ?? null,

        marksObtained,

        totalMarks,

        passingMarks,

        percentage,

        score,

        status,

        grade:
          result?.grade ?? null,

        feedback:
          result?.feedback ?? null,

        submittedAt:
          result?.submittedAt ?? null,

        flagged:
          result?.flagged ?? false,

        attempted:
          Boolean(result),

        examStarted,

        examCompleted,
      };
    });

    /* ------------------------------------------------------
       STATS
    ------------------------------------------------------ */

    const stats = {
      total: data.length,

      pending: data.filter(
        (student) =>
          student.status === "Pending"
      ).length,

      passed: data.filter(
        (student) =>
          student.status === "Passed"
      ).length,

      failed: data.filter(
        (student) =>
          student.status === "Failed"
      ).length,

      absent: data.filter(
        (student) =>
          student.status === "Absent"
      ).length,

      attempted: data.filter(
        (student) =>
          student.attempted
      ).length,
    };

    /* ------------------------------------------------------
       RESPONSE
    ------------------------------------------------------ */

    return res.json({
      success: true,

      data: {
        exam: {
          id: exam.id,

          title: exam.title,

          examCode: exam.examCode,

          type: exam.type,

          courseId:
            exam.courseId,

          courseName:
            exam.course?.title ??
            "Unknown Course",

          batchId:
            exam.batchId,

          batchName:
            exam.batch?.name ??
            "Unknown Batch",

          batchCode:
            exam.batch?.code ??
            null,

          date:
            exam.date,

          durationMins:
            Number(exam.durationMins),

          totalMarks:
            Number(exam.totalMarks),

          passingMarks:
            Number(exam.passingMarks),

          passingPercentage:
            exam.totalMarks > 0
              ? calculatePercentage(
                  Number(exam.passingMarks),
                  Number(exam.totalMarks)
                )
              : 0,

          examStarted,

          examCompleted,
        },

        students: data,

        stats,
      },
    });
  } catch (error) {
    console.error(
      "getExamStudents error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch exam students",
    });
  }
};