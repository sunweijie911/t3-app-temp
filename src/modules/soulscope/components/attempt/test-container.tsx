'use client';

import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LoadingSpinner } from '@/shared/components/ui/loading-spinner';
import { api } from '@/trpc/react';
import { ProgressBar } from './progress-bar';
import { QuestionCard } from './question-card';

interface TestContainerProps {
  attemptId: string;
}

export function TestContainer({ attemptId }: TestContainerProps) {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    data: questions,
    isLoading,
    isError,
  } = api.soulscope.attempt.getQuestions.useQuery({
    attemptId,
  });

  const submitBatch = api.soulscope.attempt.submitBatch.useMutation();
  const complete = api.soulscope.attempt.complete.useMutation();

  // Clear auto-advance timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimer.current) {
        clearTimeout(autoAdvanceTimer.current);
      }
    };
  }, []);

  // Warn before leaving with unsaved answers
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (Object.keys(answers).length > 0 && !isSubmitting) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [answers, isSubmitting]);

  const handleSelect = useCallback(
    (value: string) => {
      if (!questions) return;
      const question = questions[currentIndex];
      if (!question) return;

      setAnswers((prev) => ({ ...prev, [question.id]: value }));

      // Clear any pending auto-advance
      if (autoAdvanceTimer.current) {
        clearTimeout(autoAdvanceTimer.current);
      }

      // Auto-save answer to server (fire-and-forget, handleComplete retries all)
      submitBatch.mutate({
        attemptId,
        answers: [{ questionId: question.id, selectedValue: value }],
      });

      // Auto-advance after brief delay
      if (currentIndex < questions.length - 1) {
        autoAdvanceTimer.current = setTimeout(() => {
          setCurrentIndex((prev) => prev + 1);
        }, 300);
      }
    },
    [currentIndex, questions, attemptId, submitBatch.mutate],
  );

  const handleComplete = useCallback(async () => {
    if (!questions) return;
    setIsSubmitting(true);

    try {
      const answerArray = Object.entries(answers).map(
        ([questionId, selectedValue]) => ({
          questionId,
          selectedValue,
        }),
      );
      await submitBatch.mutateAsync({ attemptId, answers: answerArray });

      const result = await complete.mutateAsync({ attemptId });
      router.push(`/soulscope/results/${result.resultId}`);
    } catch (_error) {
      toast.error('提交失败，请稍后重试');
      setIsSubmitting(false);
    }
  }, [
    answers,
    attemptId,
    complete.mutateAsync,
    questions,
    router,
    submitBatch.mutateAsync,
  ]);

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (isError || !questions) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-gray-500">加载题目失败，请刷新页面重试</p>
        <button
          className="rounded-lg border border-gray-300 px-4 py-2 text-gray-600 text-sm transition-colors hover:bg-gray-50"
          onClick={() => router.back()}
          type="button"
        >
          返回
        </button>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount === questions.length;

  if (!currentQuestion) return null;

  return (
    <div className="py-8">
      <ProgressBar current={answeredCount} total={questions.length} />

      <div className="mt-8">
        <QuestionCard
          description={currentQuestion.description}
          onSelect={handleSelect}
          options={
            currentQuestion.options as Array<{ value: string; label: string }>
          }
          questionIndex={currentIndex}
          selectedValue={answers[currentQuestion.id]}
          text={currentQuestion.text}
          totalQuestions={questions.length}
        />
      </div>

      <div className="mx-auto mt-8 flex max-w-2xl items-center justify-between">
        <button
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-gray-500 text-sm transition-colors hover:bg-gray-100 disabled:opacity-50"
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
          type="button"
        >
          <ChevronLeft className="h-4 w-4" />
          上一题
        </button>

        {currentIndex < questions.length - 1 ? (
          <button
            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-6 py-2 font-medium text-sm text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
            disabled={!answers[currentQuestion.id]}
            onClick={() => setCurrentIndex((prev) => prev + 1)}
            type="button"
          >
            下一题
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-2 font-medium text-sm text-white transition-colors hover:from-purple-700 hover:to-pink-700 disabled:opacity-50"
            disabled={!allAnswered || isSubmitting}
            onClick={handleComplete}
            type="button"
          >
            <Check className="h-4 w-4" />
            {isSubmitting ? '提交中...' : '完成测试'}
          </button>
        )}
      </div>
    </div>
  );
}
