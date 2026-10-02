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
    <div className="flex h-[calc(100dvh-9rem)] flex-col md:h-[calc(100dvh-7rem)]">
      <PageHeader title="Study Copilot" subtitle="Tell it what you want to get done. It proposes changes; nothing happens until you confirm." />
      <div className="min-h-0 flex-1">
        <CopilotChat initialPrompt={prompt ? (PROMPTS[prompt] ?? prompt) : null} />
      </div>
    </div>
  );
}
