import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Play, ChevronDown, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface CourseLesson {
  id: string;
  title: string;
  video_url: string;
  course_id: string;
  course_title: string;
  order_index: number;
  module_title: string;
  module_order: number;
}

interface GroupedCourse {
  id: string;
  title: string;
  lessonCount: number;
  modules: {
    title: string;
    order_index: number;
    lessons: CourseLesson[];
  }[];
}

interface VideoSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lessons: CourseLesson[];
  loading: boolean;
  onSelectVideo: (videoUrl: string, lessonTitle: string) => void;
}

const VideoSelectDialog = ({
  open,
  onOpenChange,
  lessons,
  loading,
  onSelectVideo,
}: VideoSelectDialogProps) => {
  // Track which courses are expanded. Default: all collapsed so users see a
  // compact list of courses and drill down only to the one they want.
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());

  const grouped = useMemo<GroupedCourse[]>(() => {
    const out: GroupedCourse[] = [];
    lessons.forEach((lesson) => {
      let course = out.find((c) => c.id === lesson.course_id);
      if (!course) {
        course = {
          id: lesson.course_id,
          title: lesson.course_title,
          lessonCount: 0,
          modules: [],
        };
        out.push(course);
      }
      let module = course.modules.find((m) => m.title === lesson.module_title);
      if (!module) {
        module = {
          title: lesson.module_title,
          order_index: lesson.module_order,
          lessons: [],
        };
        course.modules.push(module);
      }
      module.lessons.push(lesson);
      course.lessonCount += 1;
    });
    out.forEach((course) => {
      course.modules.sort((a, b) => a.order_index - b.order_index);
      course.modules.forEach((module) => {
        module.lessons.sort((a, b) => a.order_index - b.order_index);
      });
    });
    return out;
  }, [lessons]);

  const toggleCourse = (courseId: string) => {
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>בחירת סרטון לצפייה משותפת</DialogTitle>
        </DialogHeader>
        <div className="max-h-[400px] overflow-y-auto pr-1">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : lessons.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              אין סרטונים זמינים. יש להירשם לקורסים כדי לצפות בסרטונים.
            </p>
          ) : (
            <div className="space-y-2">
              {grouped.map((course) => {
                const isOpen = expandedCourses.has(course.id);
                return (
                  <div
                    key={course.id}
                    className="rounded-lg border border-border/60 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCourse(course.id)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-right bg-secondary/50 hover:bg-secondary transition-colors"
                    >
                      <ChevronDown
                        className={cn(
                          "w-4 h-4 shrink-0 transition-transform",
                          isOpen && "rotate-180"
                        )}
                      />
                      <BookOpen className="w-4 h-4 text-primary shrink-0" />
                      <span className="font-semibold text-sm truncate flex-1">
                        {course.title}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {course.lessonCount}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="p-2 space-y-2 bg-background">
                        {course.modules.map((module, moduleIdx) => (
                          <div key={moduleIdx} className="space-y-1">
                            <div className="text-xs text-muted-foreground px-2 py-1 font-medium">
                              {module.title}
                            </div>
                            {module.lessons.map((lesson) => (
                              <button
                                key={lesson.id}
                                className="w-full p-2.5 text-right rounded-md border border-border/50 hover:bg-secondary/50 hover:border-primary/30 transition-colors"
                                onClick={() =>
                                  onSelectVideo(lesson.video_url, lesson.title)
                                }
                              >
                                <div className="flex items-center gap-2">
                                  <Play className="w-3.5 h-3.5 text-primary shrink-0" />
                                  <span className="text-sm truncate">
                                    {lesson.title}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VideoSelectDialog;
