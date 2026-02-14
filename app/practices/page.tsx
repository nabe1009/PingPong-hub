import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus } from "lucide-react";
import { PracticeList } from "./practice-list";

export default function PracticesPage() {
  return (
    <div className="w-full px-4 py-8 md:max-w-5xl md:mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">練習一覧</h1>
        <Button asChild>
          <Link href="/practices/new" className="gap-2">
            <Plus className="size-4" />
            新規登録
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>登録された練習</CardTitle>
          <CardDescription>Supabase の practices テーブルから取得しています。</CardDescription>
        </CardHeader>
        <CardContent>
          <PracticeList />
        </CardContent>
      </Card>
    </div>
  );
}
