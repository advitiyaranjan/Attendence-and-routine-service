import { useSearchParams } from 'react-router';
import { CopilotChat } from '../components/copilot/CopilotChat';
import { PageHeader } from '../components/ui';

const PROMPTS: Record<string, string> = {
  'plan-today': 'What do I need to do today? Then organise my evening.',
};

export default function Assistant() {
  const [params] = useSearchParams();
  const prompt = params.get('prompt');
  return (
    <div className="mx-auto flex h-[calc(100dvh-11rem-var(--sat)-var(--sab))] max-w-3xl flex-col md:h-[calc(100dvh-9rem)]">
      <PageHeader title="AI Pilot" subtitle="Manage your whole workspace in plain words. Nothing changes until you confirm." />
      <div className="min-h-0 flex-1">
        <CopilotChat initialPrompt={prompt ? (PROMPTS[prompt] ?? prompt) : null} />
      </div>
    </div>
  );
}
