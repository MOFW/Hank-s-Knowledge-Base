import { AppLink } from "@/components/app-link";
import { ArrowRight } from "lucide-react";
import type { getCourse } from "@/services/catalog";
import { Markdown } from "./markdown";

type Course = NonNullable<Awaited<ReturnType<typeof getCourse>>>;

export function CourseShelf({ courses }: { courses: Course[] }) {
  if (!courses.length) return <p className="empty">还没有课程。</p>;
  return (
    <ul className="course-shelf">
      {courses.map((course) => (
        <li key={course.id}>
          <h2><AppLink href={`/courses/${course.id}`}>{course.name}<ArrowRight size={18} aria-hidden="true" /></AppLink></h2>
          {course.descriptionMd.trim() && <Markdown source={course.descriptionMd} />}
        </li>
      ))}
    </ul>
  );
}
