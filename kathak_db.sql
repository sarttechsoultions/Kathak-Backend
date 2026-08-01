--
-- PostgreSQL database dump
--

\restrict lXpD0MM3g8PCyPkb2dc5nydfEJ39qJgXDyBtLsYbfvVDd4PSJEaoUoFwudgJqbn

-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: AttendanceStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."AttendanceStatus" AS ENUM (
    'PRESENT',
    'ABSENT',
    'LATE',
    'LEAVE'
);


ALTER TYPE public."AttendanceStatus" OWNER TO postgres;

--
-- Name: ClassMode; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ClassMode" AS ENUM (
    'ONLINE',
    'OFFLINE',
    'HYBRID'
);


ALTER TYPE public."ClassMode" OWNER TO postgres;

--
-- Name: CourseCategory; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."CourseCategory" AS ENUM (
    'BASIC',
    'INTERMEDIATE',
    'PREMIUM'
);


ALTER TYPE public."CourseCategory" OWNER TO postgres;

--
-- Name: Currency; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."Currency" AS ENUM (
    'INR',
    'USD',
    'GBP',
    'EUR'
);


ALTER TYPE public."Currency" OWNER TO postgres;

--
-- Name: LiveClassStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."LiveClassStatus" AS ENUM (
    'SCHEDULED',
    'LIVE',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE public."LiveClassStatus" OWNER TO postgres;

--
-- Name: PaymentStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."PaymentStatus" AS ENUM (
    'PENDING',
    'SUCCESS',
    'FAILED',
    'REFUNDED'
);


ALTER TYPE public."PaymentStatus" OWNER TO postgres;

--
-- Name: Permission; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."Permission" AS ENUM (
    'VIEW_DASHBOARD',
    'MANAGE_COURSES',
    'MANAGE_STUDENTS',
    'MANAGE_TEACHERS',
    'MANAGE_BATCHES',
    'MANAGE_ASSIGNMENTS',
    'MANAGE_CLASSES',
    'MANAGE_RECORDED_CLASSES',
    'MANAGE_VIDEO_REVIEWS',
    'MANAGE_EXAMS',
    'VIEW_EXAM_RESULTS',
    'MANAGE_ATTENDANCE',
    'MANAGE_EVENTS',
    'MANAGE_COMMUNICATION',
    'MANAGE_CONTENT_LIBRARY',
    'VIEW_PAYMENTS',
    'MANAGE_WEBSITE',
    'VIEW_ANALYTICS',
    'MANAGE_CERTIFICATES',
    'MANAGE_SETTINGS',
    'MANAGE_SUPPORT',
    'MANAGE_INQUIRIES',
    'MANAGE_GALLERY',
    'MANAGE_REVIEWS',
    'VIEW_COURSES',
    'CREATE_COURSE',
    'EDIT_COURSE',
    'DELETE_COURSE',
    'VIEW_STUDENTS',
    'CREATE_STUDENT',
    'EDIT_STUDENT',
    'DELETE_STUDENT',
    'VIEW_TEACHERS',
    'CREATE_TEACHER',
    'EDIT_TEACHER',
    'DELETE_TEACHER',
    'VIEW_BATCHES',
    'CREATE_BATCH',
    'EDIT_BATCH',
    'DELETE_BATCH',
    'VIEW_ASSIGNMENTS',
    'CREATE_ASSIGNMENT',
    'GRADE_ASSIGNMENT',
    'VIEW_CLASSES',
    'START_LIVE_CLASS',
    'UPLOAD_RECORDED_CLASS',
    'VIEW_VIDEO_REVIEWS',
    'EVALUATE_VIDEO_REVIEW',
    'VIEW_EXAMS',
    'CREATE_EXAM',
    'GRADE_EXAMS',
    'VIEW_ATTENDANCE',
    'MARK_ATTENDANCE',
    'VIEW_EVENTS',
    'VIEW_COMMUNICATION',
    'SEND_COMMUNICATION',
    'ISSUE_CERTIFICATE',
    'ANSWER_SUPPORT'
);


ALTER TYPE public."Permission" OWNER TO postgres;

--
-- Name: Role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."Role" AS ENUM (
    'ADMIN',
    'TEACHER',
    'STUDENT'
);


ALTER TYPE public."Role" OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Attendance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Attendance" (
    id text NOT NULL,
    "studentId" text NOT NULL,
    "studentName" text NOT NULL,
    "batchId" text,
    "batchName" text NOT NULL,
    date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status public."AttendanceStatus" DEFAULT 'PRESENT'::public."AttendanceStatus" NOT NULL,
    remarks text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    session text DEFAULT 'General'::text NOT NULL
);


ALTER TABLE public."Attendance" OWNER TO postgres;

--
-- Name: Batch; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Batch" (
    id text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    "courseId" text,
    "courseName" text NOT NULL,
    level text DEFAULT 'ADVANCED'::text NOT NULL,
    "teacherName" text DEFAULT 'Arjun Sharma'::text NOT NULL,
    schedule text NOT NULL,
    "totalStudents" integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'Active'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Batch" OWNER TO postgres;

--
-- Name: BatchStudent; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."BatchStudent" (
    id text NOT NULL,
    "batchId" text NOT NULL,
    "studentId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."BatchStudent" OWNER TO postgres;

--
-- Name: Course; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Course" (
    id text NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    description text NOT NULL,
    category public."CourseCategory" DEFAULT 'BASIC'::public."CourseCategory" NOT NULL,
    "groupFeeINR" double precision NOT NULL,
    "groupFeeUSD" double precision NOT NULL,
    "groupClassesCount" text NOT NULL,
    "oneToOneFeeINR" double precision NOT NULL,
    "oneToOneFeeUSD" double precision NOT NULL,
    "oneToOneClassesCount" text NOT NULL,
    "badgeBgColor" text DEFAULT '#76D7C4'::text NOT NULL,
    "borderColor" text DEFAULT 'border-[#76D7C4]'::text NOT NULL,
    published boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Course" OWNER TO postgres;

--
-- Name: Enrollment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Enrollment" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "courseId" text NOT NULL,
    mode public."ClassMode" DEFAULT 'ONLINE'::public."ClassMode" NOT NULL,
    type text DEFAULT 'GROUP'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Enrollment" OWNER TO postgres;

--
-- Name: Inquiry; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Inquiry" (
    id text NOT NULL,
    "userId" text,
    "fullName" text NOT NULL,
    "contactInfo" text NOT NULL,
    "classMode" text NOT NULL,
    subject text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'NEW'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Inquiry" OWNER TO postgres;

--
-- Name: Lesson; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Lesson" (
    id text NOT NULL,
    "courseId" text NOT NULL,
    title text NOT NULL,
    description text,
    "orderIndex" integer NOT NULL,
    "durationSec" integer NOT NULL,
    "bunnyVideoId" text NOT NULL,
    "videoLibraryId" text NOT NULL,
    "isFreePreview" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Lesson" OWNER TO postgres;

--
-- Name: LiveClass; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."LiveClass" (
    id text NOT NULL,
    "batchId" text NOT NULL,
    title text NOT NULL,
    "teacherName" text NOT NULL,
    "scheduledStart" timestamp(3) without time zone NOT NULL,
    "scheduledEnd" timestamp(3) without time zone NOT NULL,
    "roomName" text NOT NULL,
    status public."LiveClassStatus" DEFAULT 'SCHEDULED'::public."LiveClassStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."LiveClass" OWNER TO postgres;

--
-- Name: Payment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Payment" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "enrollmentId" text,
    amount double precision NOT NULL,
    currency public."Currency" DEFAULT 'INR'::public."Currency" NOT NULL,
    gateway text NOT NULL,
    "transactionId" text NOT NULL,
    "orderId" text NOT NULL,
    status public."PaymentStatus" DEFAULT 'PENDING'::public."PaymentStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Payment" OWNER TO postgres;

--
-- Name: TeacherPermission; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."TeacherPermission" (
    id text NOT NULL,
    "userId" text NOT NULL,
    permission public."Permission" NOT NULL
);


ALTER TABLE public."TeacherPermission" OWNER TO postgres;

--
-- Name: User; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."User" (
    id text NOT NULL,
    "fullName" text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    "passwordHash" text NOT NULL,
    role public."Role" DEFAULT 'STUDENT'::public."Role" NOT NULL,
    "avatarUrl" text,
    country text DEFAULT 'India'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."User" OWNER TO postgres;

--
-- Data for Name: Attendance; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Attendance" (id, "studentId", "studentName", "batchId", "batchName", date, status, remarks, "createdAt", "updatedAt", session) FROM stdin;
\.


--
-- Data for Name: Batch; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Batch" (id, name, code, "courseId", "courseName", level, "teacherName", schedule, "totalStudents", status, "createdAt", "updatedAt") FROM stdin;
bb62ecc7-bf4a-41b8-b157-ca7c5f3eacdd	Beginners Morning Zen (7:00 AM)	KTH-101-BEG-AM	95b0525e-41c5-472a-8843-92dccccd6ac6	Kathak Beginners Course	BEGINNER	Guru Harshita	Mon,Wed,Fri 07:00 AM - 08:30 AM	0	Active	2026-08-01 07:09:05.956	2026-08-01 07:09:05.956
a5a3907d-11a2-4705-acbe-483eab01419f	Intermediate Evening Batch (5:00 PM)	KTH-201-INT-PM	adba5a41-3f48-404c-b07c-b22a2a96148b	Kathak Intermediate Course	INTERMEDIATE	Guru Meenakshi	Tue,Thu,Sat 05:00 PM - 06:30 PM	0	Active	2026-08-01 07:09:05.96	2026-08-01 07:09:05.96
32272358-b769-43ff-887f-69d179d73664	Advanced Mastery Weekend (10:00 AM)	KTH-301-ADV-WK	2376301b-140d-4f20-b39f-416454046036	Kathak Advanced Mastery Course	ADVANCED	Guru Harshita	Sat,Sun 10:00 AM - 12:00 PM	0	Active	2026-08-01 07:09:05.962	2026-08-01 07:09:05.962
9bee8847-c56c-4ac8-a420-f2f99fb0357d	Ladies Wellness Morning Batch (11:00 AM)	KTH-102-WELL-AM	eee4f8d7-aad7-4c70-b753-14a1560c37e3	Ladies Wellness Kathak Batch	BEGINNER	Guru Sunita	Mon,Wed,Fri 11:00 AM - 12:15 PM	0	Active	2026-08-01 07:09:05.963	2026-08-01 07:09:05.963
d6b8c9c1-c771-47fb-8c4b-58d46de89f77	Kids Foundation Batch (4:00 PM)	KTH-103-KIDS-PM	9d5528c5-9cb2-49e9-8092-9358f91586b5	Kathak Kids Batch (Age 5+)	BEGINNER	Guru Ananya	Mon,Wed,Fri 04:00 PM - 05:00 PM	0	Active	2026-08-01 07:09:05.965	2026-08-01 07:09:05.965
3f05894c-d1b5-4d5f-b3e7-aef023d87fd2	Hobby Kathak Evening Batch (6:30 PM)	KTH-202-HOBBY-PM	5a474774-45b5-425b-9e3a-ad218bd0d790	Hobby Kathak Batch	INTERMEDIATE	Guru Meenakshi	Mon,Wed,Fri 03:40 PM	1	Active	2026-08-01 07:09:05.966	2026-08-01 10:07:51.95
\.


--
-- Data for Name: BatchStudent; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."BatchStudent" (id, "batchId", "studentId", "createdAt") FROM stdin;
289ee4b3-067e-4634-9eca-5b02e6827c24	3f05894c-d1b5-4d5f-b3e7-aef023d87fd2	04ae5ccd-c691-41c5-82c8-21fa6186d07b	2026-08-01 10:07:51.95
\.


--
-- Data for Name: Course; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Course" (id, title, slug, description, category, "groupFeeINR", "groupFeeUSD", "groupClassesCount", "oneToOneFeeINR", "oneToOneFeeUSD", "oneToOneClassesCount", "badgeBgColor", "borderColor", published, "createdAt", "updatedAt") FROM stdin;
9d5528c5-9cb2-49e9-8092-9358f91586b5	Kathak Kids Batch (Age 5+)	kathak-kids-batch-age-5	Restored academy course	BASIC	2200	50	10 Classes/month	700	18	Min 4 Classes/month (Compulsory)	/Grace2.png	Beginner	t	2026-08-01 07:09:05.952	2026-08-01 07:09:05.952
5a474774-45b5-425b-9e3a-ad218bd0d790	Hobby Kathak Batch	hobby-kathak-batch	Restored academy course	BASIC	2500	60	8 Classes/month	800	20	8 Classes/month	/Grace3.png	Beginner	t	2026-08-01 07:09:05.953	2026-08-01 07:09:05.953
95b0525e-41c5-472a-8843-92dccccd6ac6	Kathak Beginners Course	kathak-beginners-course	Restored academy course	BASIC	2200	50	10 Classes/month	600	15	Min 4 Classes/month (Compulsory)	/gurukul-dancer.jpg	Beginner	t	2026-08-01 07:09:05.929	2026-08-01 07:09:05.929
adba5a41-3f48-404c-b07c-b22a2a96148b	Kathak Intermediate Course	kathak-intermediate-course	Restored academy course	BASIC	2500	60	8 Classes/month	900	22	Min 5 Classes/month (Compulsory)	/course-dancer.jpg	Intermediate	t	2026-08-01 07:09:05.946	2026-08-01 07:09:05.946
2376301b-140d-4f20-b39f-416454046036	Kathak Advanced Mastery Course	kathak-advanced-course	Restored academy course	BASIC	3200	75	8 Classes/month	1200	30	Min 5-6 Classes/month (Compulsory)	/about-1.jpg	Advanced	t	2026-08-01 07:09:05.948	2026-08-01 07:09:05.948
eee4f8d7-aad7-4c70-b753-14a1560c37e3	Ladies Wellness Kathak Batch	ladies-wellness-kathak-batch	Restored academy course	BASIC	2200	50	8 Classes/month	700	18	Min 4 Classes/month (Compulsory)	/Grace1.png	Beginner	t	2026-08-01 07:09:05.95	2026-08-01 07:09:05.95
\.


--
-- Data for Name: Enrollment; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Enrollment" (id, "userId", "courseId", mode, type, active, "expiresAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: Inquiry; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Inquiry" (id, "userId", "fullName", "contactInfo", "classMode", subject, message, status, "createdAt") FROM stdin;
\.


--
-- Data for Name: Lesson; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Lesson" (id, "courseId", title, description, "orderIndex", "durationSec", "bunnyVideoId", "videoLibraryId", "isFreePreview", "createdAt") FROM stdin;
\.


--
-- Data for Name: LiveClass; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."LiveClass" (id, "batchId", title, "teacherName", "scheduledStart", "scheduledEnd", "roomName", status, "createdAt", "updatedAt") FROM stdin;
3f4e755d-0d9e-4916-b949-8c201fec0bcc	3f05894c-d1b5-4d5f-b3e7-aef023d87fd2	dsdd	Guru Meenakshi	2026-08-01 07:15:00	2026-08-01 08:15:00	kathak-kth202hobbypm-msa1artg	COMPLETED	2026-08-01 07:12:39.51	2026-08-01 09:12:24.413
38a2970a-6b16-47b9-ac4c-d3d6869c8cee	3f05894c-d1b5-4d5f-b3e7-aef023d87fd2	sdc	Guru Meenakshi	2026-08-01 10:13:00	2026-08-01 12:12:00	kathak-kth202hobbypm-msa7nbvk	LIVE	2026-08-01 10:10:23.077	2026-08-01 10:10:31.43
\.


--
-- Data for Name: Payment; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Payment" (id, "userId", "enrollmentId", amount, currency, gateway, "transactionId", "orderId", status, "createdAt") FROM stdin;
\.


--
-- Data for Name: TeacherPermission; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."TeacherPermission" (id, "userId", permission) FROM stdin;
3ab3a894-7079-4de8-918d-e7010ad579da	61ef889a-32f9-4cee-9393-b51850eef222	MANAGE_STUDENTS
633872a3-4225-49a9-b876-43d01e1e3032	61ef889a-32f9-4cee-9393-b51850eef222	MANAGE_BATCHES
51cb065d-8d50-44e5-b39a-8070fd58a22a	61ef889a-32f9-4cee-9393-b51850eef222	MANAGE_COURSES
a8db0725-7cdc-4403-9ed2-43b415c7dd8a	61ef889a-32f9-4cee-9393-b51850eef222	MANAGE_RECORDED_CLASSES
0201f497-34eb-4885-849e-edcea9bffcba	61ef889a-32f9-4cee-9393-b51850eef222	VIEW_EXAM_RESULTS
bcc977e3-6df5-4c24-8e9a-0c8926245e69	61ef889a-32f9-4cee-9393-b51850eef222	MANAGE_ATTENDANCE
6e22d872-df39-4734-84fb-df698c2e951a	61ef889a-32f9-4cee-9393-b51850eef222	MANAGE_COMMUNICATION
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."User" (id, "fullName", email, phone, "passwordHash", role, "avatarUrl", country, "isActive", "createdAt", "updatedAt") FROM stdin;
615b09b3-ac56-49c3-844f-d5e9740658b2	Super Admin	admin@kathakbyharshita.com	+919876543210	$2b$10$GA6sBWvEeNDFw8HXFMVBUeZLoBUFC87KUT4Iu0Jb8GEx0Fg59QCFC	ADMIN	\N	India	t	2026-07-31 11:18:29.776	2026-07-31 11:18:29.776
61ef889a-32f9-4cee-9393-b51850eef222	Sidhi	sid@gmail.com	+917878788	$2b$10$5m3aodeO/hKwO8O/VBUM8uo8.lqbsV.Q6K/rRrQV/cugIY1ohvUdW	TEACHER	\N	India	t	2026-07-31 11:36:04.059	2026-07-31 11:36:04.059
04ae5ccd-c691-41c5-82c8-21fa6186d07b	anamika	ana@gmail.com	78787878787	$2b$10$NRrSO0Cd1ywZodkBProPWO6vYBfsjMxivoPFQQe42UyFnQG7FjoD.	STUDENT	/Ananya.png	India	t	2026-08-01 05:13:19.655	2026-08-01 05:13:19.655
83916de6-ac7b-47ec-89c5-fd5b7542c2d5	Guru Harshita	harshita@kathak.edu	+91 98765 00001	$2b$10$UeHkIjYOqVsDoKl3hwnF1e03Dt9l3RsG6paN33wKE6L.oMk/8qX3K	TEACHER	/Grace1.png	India	t	2026-08-01 07:09:06.042	2026-08-01 07:09:06.042
bcaa2024-4326-4cc6-b6b9-a420ee56a995	Guru Meenakshi	meenakshi@kathak.edu	+91 98765 00002	$2b$10$UeHkIjYOqVsDoKl3hwnF1e03Dt9l3RsG6paN33wKE6L.oMk/8qX3K	TEACHER	/Meera.png	India	t	2026-08-01 07:09:06.046	2026-08-01 07:09:06.046
6dd66369-932f-4c08-8668-f05ec0e58efc	Guru Sunita	sunita@kathak.edu	+91 98765 00003	$2b$10$UeHkIjYOqVsDoKl3hwnF1e03Dt9l3RsG6paN33wKE6L.oMk/8qX3K	TEACHER	/Sunita.png	India	t	2026-08-01 07:09:06.047	2026-08-01 07:09:06.047
4c87de3b-906f-4e11-a915-dc7fd3965399	Guru Ananya	ananya@kathak.edu	+91 98765 00004	$2b$10$UeHkIjYOqVsDoKl3hwnF1e03Dt9l3RsG6paN33wKE6L.oMk/8qX3K	TEACHER	/Ananya.png	India	t	2026-08-01 07:09:06.049	2026-08-01 07:09:06.049
2ed5b4b4-791d-42b9-88be-128a68dd0c2f	Siddhi	siddhi@kathak.edu	+91 98765 00005	$2b$10$UeHkIjYOqVsDoKl3hwnF1e03Dt9l3RsG6paN33wKE6L.oMk/8qX3K	TEACHER	/Grace1.png	India	t	2026-08-01 07:09:06.05	2026-08-01 07:09:06.05
\.


--
-- Name: Attendance Attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Attendance"
    ADD CONSTRAINT "Attendance_pkey" PRIMARY KEY (id);


--
-- Name: BatchStudent BatchStudent_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."BatchStudent"
    ADD CONSTRAINT "BatchStudent_pkey" PRIMARY KEY (id);


--
-- Name: Batch Batch_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Batch"
    ADD CONSTRAINT "Batch_pkey" PRIMARY KEY (id);


--
-- Name: Course Course_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Course"
    ADD CONSTRAINT "Course_pkey" PRIMARY KEY (id);


--
-- Name: Enrollment Enrollment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Enrollment"
    ADD CONSTRAINT "Enrollment_pkey" PRIMARY KEY (id);


--
-- Name: Inquiry Inquiry_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Inquiry"
    ADD CONSTRAINT "Inquiry_pkey" PRIMARY KEY (id);


--
-- Name: Lesson Lesson_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Lesson"
    ADD CONSTRAINT "Lesson_pkey" PRIMARY KEY (id);


--
-- Name: LiveClass LiveClass_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."LiveClass"
    ADD CONSTRAINT "LiveClass_pkey" PRIMARY KEY (id);


--
-- Name: Payment Payment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_pkey" PRIMARY KEY (id);


--
-- Name: TeacherPermission TeacherPermission_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TeacherPermission"
    ADD CONSTRAINT "TeacherPermission_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: Attendance_batchId_date_session_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Attendance_batchId_date_session_idx" ON public."Attendance" USING btree ("batchId", date, session);


--
-- Name: BatchStudent_batchId_studentId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "BatchStudent_batchId_studentId_key" ON public."BatchStudent" USING btree ("batchId", "studentId");


--
-- Name: BatchStudent_studentId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "BatchStudent_studentId_idx" ON public."BatchStudent" USING btree ("studentId");


--
-- Name: Batch_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Batch_code_key" ON public."Batch" USING btree (code);


--
-- Name: Course_slug_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Course_slug_key" ON public."Course" USING btree (slug);


--
-- Name: LiveClass_batchId_scheduledStart_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "LiveClass_batchId_scheduledStart_idx" ON public."LiveClass" USING btree ("batchId", "scheduledStart");


--
-- Name: LiveClass_roomName_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "LiveClass_roomName_key" ON public."LiveClass" USING btree ("roomName");


--
-- Name: Payment_orderId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Payment_orderId_key" ON public."Payment" USING btree ("orderId");


--
-- Name: Payment_transactionId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Payment_transactionId_key" ON public."Payment" USING btree ("transactionId");


--
-- Name: TeacherPermission_userId_permission_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "TeacherPermission_userId_permission_key" ON public."TeacherPermission" USING btree ("userId", permission);


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: User_phone_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_phone_key" ON public."User" USING btree (phone);


--
-- Name: Attendance Attendance_batchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Attendance"
    ADD CONSTRAINT "Attendance_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."Batch"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Attendance Attendance_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Attendance"
    ADD CONSTRAINT "Attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BatchStudent BatchStudent_batchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."BatchStudent"
    ADD CONSTRAINT "BatchStudent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."Batch"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BatchStudent BatchStudent_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."BatchStudent"
    ADD CONSTRAINT "BatchStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Batch Batch_courseId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Batch"
    ADD CONSTRAINT "Batch_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES public."Course"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Enrollment Enrollment_courseId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Enrollment"
    ADD CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES public."Course"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Enrollment Enrollment_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Enrollment"
    ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Inquiry Inquiry_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Inquiry"
    ADD CONSTRAINT "Inquiry_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Lesson Lesson_courseId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Lesson"
    ADD CONSTRAINT "Lesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES public."Course"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: LiveClass LiveClass_batchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."LiveClass"
    ADD CONSTRAINT "LiveClass_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."Batch"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Payment Payment_enrollmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES public."Enrollment"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Payment Payment_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TeacherPermission TeacherPermission_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TeacherPermission"
    ADD CONSTRAINT "TeacherPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict lXpD0MM3g8PCyPkb2dc5nydfEJ39qJgXDyBtLsYbfvVDd4PSJEaoUoFwudgJqbn

