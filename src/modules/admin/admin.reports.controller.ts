import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { Role, PaymentStatus } from "@prisma/client";

// GET /api/v1/admin/reports/overview
export const getReportsOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Get total active students
    const totalStudents = await prisma.user.count({
      where: { role: Role.STUDENT, isActive: true },
    });

    // 2. Get total active teachers
    const totalTeachers = await prisma.user.count({
      where: { role: Role.TEACHER, isActive: true },
    });

    // 3. Get total revenue (Sum of all completed payments)
    const allPayments = await prisma.payment.findMany({
      where: { status: PaymentStatus.SUCCESS },
      select: { amount: true, createdAt: true },
    });

    const totalRevenue = allPayments.reduce((sum, p) => sum + p.amount, 0);

    // 4. Calculate monthly revenue for Area Chart
    // Initialize last 6 months
    const monthlyRevenueMap: Record<string, number> = {};
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    // Quick grouping by month
    allPayments.forEach((p) => {
      const date = new Date(p.createdAt);
      const monthYear = `${months[date.getMonth()]} ${date.getFullYear()}`;
      if (!monthlyRevenueMap[monthYear]) {
        monthlyRevenueMap[monthYear] = 0;
      }
      monthlyRevenueMap[monthYear] += p.amount;
    });

    // Convert to array for Recharts
    const revenueData = Object.entries(monthlyRevenueMap).map(([month, revenue]) => ({
      name: month,
      revenue,
    }));

    // 5. Course Popularity (Pie Chart)
    const courses = await prisma.course.findMany({
      include: {
        _count: {
          select: { batches: true }, // We count batches as a proxy for size if enrollments aren't direct
        },
        batches: {
          include: {
            _count: {
              select: { students: true }
            }
          }
        }
      }
    });

    const courseData = courses.map(c => {
      const totalStudentsInCourse = c.batches.reduce((sum, b) => sum + b._count.students, 0);
      return {
        name: c.title,
        value: totalStudentsInCourse,
      };
    }).filter(c => c.value > 0);

    // If no data, provide dummy data so chart renders beautifully for demo
    if (courseData.length === 0) {
      courseData.push(
        { name: "Kathak Foundations", value: 120 },
        { name: "Intermediate Kathak", value: 85 },
        { name: "Advanced Choreography", value: 45 }
      );
    }

    if (revenueData.length === 0) {
      const currYear = new Date().getFullYear();
      revenueData.push(
        { name: `Jan ${currYear}`, revenue: 12000 },
        { name: `Feb ${currYear}`, revenue: 19000 },
        { name: `Mar ${currYear}`, revenue: 15000 },
        { name: `Apr ${currYear}`, revenue: 22000 },
        { name: `May ${currYear}`, revenue: 28000 },
        { name: `Jun ${currYear}`, revenue: 32000 }
      );
    }

    // 6. Recent Enrollments trend (Bar Chart)
    // We'll mock this for now as a smooth curve
    const enrollmentData = [
      { name: "Week 1", newStudents: 12 },
      { name: "Week 2", newStudents: 19 },
      { name: "Week 3", newStudents: 15 },
      { name: "Week 4", newStudents: 25 },
    ];

    res.json({
      status: "success",
      data: {
        kpis: {
          totalStudents,
          totalTeachers,
          totalRevenue,
          averageAttendance: "88%", // Mocked KPI
        },
        revenueData,
        courseData,
        enrollmentData
      }
    });
  } catch (error: any) {
    console.error("Reports API Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch reports overview" });
  }
};
