"use client";

import { useParams } from "next/navigation";
import { BookingWizard } from "@/components/book/BookingWizard";

export default function BookPage() {
  const params = useParams<{ locationSlug: string }>();
  return <BookingWizard locationSlug={String(params?.locationSlug ?? "")} />;
}
