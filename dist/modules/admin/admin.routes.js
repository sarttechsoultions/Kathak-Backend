"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const admin_controller_1 = require("./admin.controller");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
router.get("/dashboard", (0, auth_middleware_1.requirePermission)(client_1.Permission.VIEW_DASHBOARD), admin_controller_1.getDashboardStats);
router.get("/students", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_STUDENTS), admin_controller_1.getStudents);
router.post("/students", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_STUDENTS), admin_controller_1.createStudent);
router.delete("/students/:id", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_STUDENTS), admin_controller_1.deleteStudent);
router.get("/teachers", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_TEACHERS), admin_controller_1.getTeachers);
router.post("/teachers", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_TEACHERS), admin_controller_1.createTeacher);
router.put("/teachers/:id", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_TEACHERS), admin_controller_1.updateTeacher);
router.delete("/teachers/:id", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_TEACHERS), admin_controller_1.deleteTeacher);
// Course Management Routes
router.get("/courses", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_COURSES), admin_controller_1.getCourses);
router.post("/courses", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_COURSES), admin_controller_1.createCourse);
router.put("/courses/:id", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_COURSES), admin_controller_1.updateCourse);
router.delete("/courses/:id", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_COURSES), admin_controller_1.deleteCourse);
// Batch Management Routes with Fine-Grained Permissions
router.get("/batches", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_BATCHES), admin_controller_1.getBatches);
router.post("/batches", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_BATCHES), admin_controller_1.createBatch);
router.put("/batches/:id", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_BATCHES), admin_controller_1.updateBatch);
router.delete("/batches/:id", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_BATCHES), admin_controller_1.deleteBatch);
router.get("/batches/:id/students", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_BATCHES), admin_controller_1.getBatchStudents);
// Attendance Management Routes
router.get("/attendance", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_ATTENDANCE), admin_controller_1.getAttendanceRecords);
router.post("/attendance", (0, auth_middleware_1.requirePermission)(client_1.Permission.MANAGE_ATTENDANCE), admin_controller_1.saveAttendance);
exports.default = router;
