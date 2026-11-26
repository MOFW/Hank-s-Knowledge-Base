export const masteryLabels = { new: "未开始", learning: "学习中", familiar: "已熟悉", mastered: "已掌握" };
export const outcomeLabels = { unknown: "未评估", correct: "正确", partial: "部分正确", incorrect: "错误" };
export const correctionAuthorLabels = { unknown: "未注明", user: "本人", ai: "AI", mixed: "本人和 AI" };

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short",
});

export function displayDateTime(iso: string) {
  return dateTime.format(new Date(iso));
}
