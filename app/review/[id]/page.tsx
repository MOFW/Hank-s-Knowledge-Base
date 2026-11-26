import { notFound } from "next/navigation";
import { ReviewRound } from "@/components/review-round";
import { idSchema } from "@/domain/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { getReview } from "@/services/review";

export const dynamic = "force-dynamic";
export const metadata = { title: "复习练习" };

export default async function ReviewRoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerPage returnTo={`/review/${id}`}>{async (ownerId) => {
    if (!idSchema.safeParse(id).success) notFound();
    const review = await getReview(id, ownerId);
    if (!review) notFound();
    return <ReviewRound ownerId={ownerId} initial={review} />;
  }}</OwnerPage>;
}
