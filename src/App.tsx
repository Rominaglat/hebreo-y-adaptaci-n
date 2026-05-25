import { lazy } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { PlatformProvider } from "@/contexts/PlatformContext";
import { TenantProvider } from "@/contexts/TenantContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

// Eager load critical pages
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

// Lazy load other pages
const Courses = lazy(() => import("./pages/Courses"));
const CourseDetail = lazy(() => import("./pages/CourseDetail"));
const CreateCourse = lazy(() => import("./pages/CreateCourse"));
const EditCourse = lazy(() => import("./pages/EditCourse"));
const BookmarkedLessons = lazy(() => import("./pages/BookmarkedLessons"));
const StudyRooms = lazy(() => import("./pages/StudyRooms"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const Announcements = lazy(() => import("./pages/Announcements"));
const CommunityBenefits = lazy(() => import("./pages/CommunityBenefits"));
const CommunityMembers = lazy(() => import("./pages/CommunityMembers"));
const Profile = lazy(() => import("./pages/Profile"));
const ManageUsers = lazy(() => import("./pages/admin/ManageUsers"));
const PlatformSettings = lazy(() => import("./pages/admin/PlatformSettings"));
const NotFound = lazy(() => import("./pages/NotFound"));
const InstallApp = lazy(() => import("./pages/InstallApp"));
const LearningPath = lazy(() => import("./pages/LearningPath"));
const SecuritySettings = lazy(() => import("./pages/SecuritySettings"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <PlatformProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <TenantProvider>
                <Routes>
                  {/* Public routes */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/accept-invite" element={<AcceptInvite />} />

                  {/* All protected routes share DashboardLayout (stays mounted) */}
                  <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/courses" element={<Courses />} />
                    <Route path="/courses/create" element={<ProtectedRoute requireAdmin>{<CreateCourse />}</ProtectedRoute>} />
                    <Route path="/courses/favorites" element={<BookmarkedLessons />} />
                    <Route path="/courses/watch-later" element={<BookmarkedLessons />} />
                    <Route path="/courses/:id/edit" element={<ProtectedRoute requireAdminOrInstructor>{<EditCourse />}</ProtectedRoute>} />
                    <Route path="/courses/:id" element={<CourseDetail />} />
                    <Route path="/study-rooms" element={<StudyRooms />} />
                    <Route path="/calendar" element={<CalendarPage />} />
                    <Route path="/announcements" element={<Announcements />} />
                    <Route path="/community-benefits" element={<CommunityBenefits />} />
                    <Route path="/community-members" element={<CommunityMembers />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="/settings/security" element={<SecuritySettings />} />
                    <Route path="/install" element={<InstallApp />} />
                    <Route path="/learning-path" element={<LearningPath />} />
                    <Route path="/admin/users" element={<ProtectedRoute requireAdminOrInstructor>{<ManageUsers />}</ProtectedRoute>} />
                    <Route path="/admin/settings" element={<PlatformSettings />} />
                  </Route>

                  {/* Catch-all */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </TenantProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </PlatformProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
