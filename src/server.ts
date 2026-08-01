import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import "./types/auth";
import authRoutes from "./modules/auth/auth.routes";
import adminRoutes from "./modules/admin/admin.routes";
import uploadRoutes from "./modules/upload/upload.routes";
import studentRoutes from "./modules/student/student.routes";
import liveClassRoutes from "./modules/liveclass/liveclass.routes";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { generalRateLimiter } from "./middleware/rateLimit.middleware";

const app = express();

app.disable("x-powered-by");

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use(cors({
  origin: env.frontendUrl,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(generalRateLimiter);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/api/v1/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "Kathak Next Express Backend API is running smoothly!",
    timestamp: new Date().toISOString(),
    environment: env.nodeEnv,
  });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/upload", uploadRoutes);
app.use("/api/v1/student", studentRoutes);
app.use("/api/v1", liveClassRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`==================================================`);
  console.log(`🚀 Kathak Express Server running on: http://localhost:${env.port}`);
  console.log(`🔗 Health Check URL: http://localhost:${env.port}/api/v1/health`);
  console.log(`🔒 Environment: ${env.nodeEnv}`);
  console.log(`==================================================`);
});
