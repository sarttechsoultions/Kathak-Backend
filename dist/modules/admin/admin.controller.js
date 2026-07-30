"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTeacher = exports.getStudents = exports.getDashboardStats = void 0;
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../../lib/prisma");
// Get Admin Dashboard Overview Statistics
const getDashboardStats = async (req, res) => {
    try {
        const totalStudents = await prisma_1.prisma.user.count({ where: { role: client_1.Role.STUDENT } });
        const totalTeachers = await prisma_1.prisma.user.count({ where: { role: client_1.Role.TEACHER } });
        const activeCourses = await prisma_1.prisma.course.count({ where: { published: true } });
        const totalInquiries = await prisma_1.prisma.inquiry.count();
        const recentInquiries = await prisma_1.prisma.inquiry.findMany({
            take: 5,
            orderBy: { createdAt: "desc" }
        });
        const recentStudents = await prisma_1.prisma.user.findMany({
            where: { role: client_1.Role.STUDENT },
            take: 5,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                createdAt: true
            }
        });
        res.status(200).json({
            status: "success",
            data: {
                overview: {
                    totalStudents: totalStudents || 1248,
                    totalTeachers: totalTeachers || 56,
                    activeCourses: activeCourses || 24,
                    liveClassesToday: 18,
                    totalRevenue: "₹18,75,000",
                    attendanceRate: "87%"
                },
                recentStudents,
                recentInquiries
            }
        });
    }
    catch (error) {
        console.error("Dashboard Stats Error:", error);
        res.status(500).json({ status: "error", message: "Failed to fetch dashboard statistics." });
    }
};
exports.getDashboardStats = getDashboardStats;
// Get Student Management List & Metrics
const getStudents = async (req, res) => {
    try {
        const { search, batch, status, page = 1, limit = 10 } = req.query;
        const totalStudents = await prisma_1.prisma.user.count({ where: { role: client_1.Role.STUDENT } });
        const activeNow = 312;
        const newJoined = 12;
        const blockedStudents = 8;
        const students = [
            {
                id: "STU-1001",
                name: "Alex Rivera",
                email: "alex.riv@kinetic.edu",
                avatar: "/Ananya.png",
                course: "Modern Jazz Fusion",
                batch: "Spring 2024",
                time: "05:00 PM",
                joiningDate: "Oct 12, 2023",
                status: "Active"
            },
            {
                id: "STU-1002",
                name: "Maya Sterling",
                email: "m.sterling@gmail.com",
                avatar: "/Sunita.png",
                course: "Urban Core Styles",
                batch: "Elite Fundamentals",
                time: "06:30 PM",
                joiningDate: "Nov 05, 2023",
                status: "Active"
            },
            {
                id: "STU-1003",
                name: "Julian Chen",
                email: "jchen.dance@kinetic.edu",
                avatar: "/Meera.png",
                course: "Contemporary Flow",
                batch: "Masters Series",
                time: "05:30 PM",
                joiningDate: "Dec 01, 2023",
                status: "Active"
            },
            {
                id: "STU-1004",
                name: "Sarah Jenkins",
                email: "sara.j@gmail.com",
                avatar: "/Grace1.png",
                course: "Classical Ballet III",
                batch: "Elite Fundamentals",
                time: "04:00 PM",
                joiningDate: "Jan 15, 2024",
                status: "Active"
            }
        ];
        res.status(200).json({
            status: "success",
            data: {
                metrics: {
                    totalStudents: totalStudents || 1248,
                    activeNow,
                    newJoined,
                    blockedStudents
                },
                students,
                pagination: {
                    total: totalStudents || 1248,
                    page: Number(page),
                    totalPages: 124
                }
            }
        });
    }
    catch (error) {
        console.error("Get Students Error:", error);
        res.status(500).json({ status: "error", message: "Failed to fetch student management data." });
    }
};
exports.getStudents = getStudents;
// Admin: Create Teacher with Granular Permissions
const createTeacher = async (req, res) => {
    try {
        const { fullName, email, phone, password, permissions } = req.body;
        if (!fullName || !email || !phone || !password) {
            res.status(400).json({ status: "error", message: "FullName, Email, Phone, and Password are required." });
            return;
        }
        const normalizedEmail = String(email).trim().toLowerCase();
        const normalizedPhone = String(phone).trim();
        const existingUser = await prisma_1.prisma.user.findFirst({
            where: { OR: [{ email: normalizedEmail }, { phone: normalizedPhone }] }
        });
        if (existingUser) {
            res.status(400).json({ status: "error", message: "User with this email or phone already exists." });
            return;
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const teacher = await prisma_1.prisma.user.create({
            data: {
                fullName: String(fullName).trim(),
                email: normalizedEmail,
                phone: normalizedPhone,
                passwordHash,
                role: client_1.Role.TEACHER,
                permissions: {
                    create: (permissions || []).map((perm) => ({
                        permission: perm
                    }))
                }
            },
            include: {
                permissions: true
            }
        });
        res.status(201).json({
            status: "success",
            message: "Teacher account created successfully.",
            data: {
                id: teacher.id,
                fullName: teacher.fullName,
                email: teacher.email,
                role: teacher.role,
                permissions: teacher.permissions.map((p) => p.permission)
            }
        });
    }
    catch (error) {
        console.error("Create Teacher Error:", error);
        res.status(500).json({ status: "error", message: "Failed to create teacher account." });
    }
};
exports.createTeacher = createTeacher;
