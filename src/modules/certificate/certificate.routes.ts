import { Router } from "express";
import { Permission, Role } from "@prisma/client";
import { authenticate, requirePermission, requireRole } from "../../middleware/auth.middleware";
import { getStudentCertificates, issueCertificate, listCertificates, revokeCertificate, verifyCertificate } from "./certificate.controller";

export const publicCertificateRouter = Router();
publicCertificateRouter.get("/:code", verifyCertificate);

export const adminCertificateRouter = Router();
adminCertificateRouter.use(authenticate, requirePermission(Permission.MANAGE_CERTIFICATES));
adminCertificateRouter.get("/", listCertificates);
adminCertificateRouter.post("/", issueCertificate);
adminCertificateRouter.post("/:id/revoke", revokeCertificate);

export const studentCertificateRouter = Router();
studentCertificateRouter.use(authenticate, requireRole(Role.STUDENT));
studentCertificateRouter.get("/", getStudentCertificates);
