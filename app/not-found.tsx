import { AppLink } from "@/components/app-link";
export default function NotFound() {
  return <section className="gate"><h1>找不到这个页面</h1><AppLink className="button" href="/courses">返回课程目录</AppLink></section>;
}
