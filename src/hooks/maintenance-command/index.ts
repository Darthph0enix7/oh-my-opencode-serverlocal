import { createInternalAgentTextPart } from '../../utils';
import { registerCommandHook } from '../command-hook-utils';

const MAINTENANCE_PROMPT = `**MAINTENANCE PROTOCOL ENGAGED**

You are now executing a comprehensive repository maintenance and cleanup run. 

Your objectives for this session:
1. **Update Documentation:** Review and update READMEs, architecture docs, and inline comments to reflect the current state of the codebase. Ensure \`.slim/tier_state/\` files are accurate.
2. **Scrub Stale Docs:** Remove outdated documentation, resolved notes, and irrelevant comments.
3. **Code Cleanup:** Remove unused code, commented-out dead code, temporary files, and obsolete caches. 
4. **Light Refactoring:** Fix minor formatting inconsistencies or obvious tech debt if it is completely safe to do so.
5. **Version Control:** If applicable and requested, commit the finalized cleanup state to git.

Work methodically. Use \`glob\` and \`grep\` to find stale comments or temporary files. Use \`read\` to review documentation before updating it.`;

export function createMaintenanceCommandHook(): {
  registerCommand: (config: Record<string, unknown>) => void;
  handleCommandExecuteBefore: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Array<{ type: string; text?: string }> },
  ) => Promise<void>;
} {
  return {
    registerCommand: (opencodeConfig) => {
      registerCommandHook(opencodeConfig, 'maintenance', 'Run a repository maintenance and cleanup routine', 'Maintenance');
    },

    handleCommandExecuteBefore: async (input, output) => {
      if (input.command !== 'maintenance') return;

      output.parts.length = 0;
      
      const parts = [
        MAINTENANCE_PROMPT
      ];
      
      const task = input.arguments.trim();
      if (task) {
        parts.push('', `**Specific Maintenance Task:**\n${task}`);
      }
      
      output.parts.push({ type: 'text', text: parts.join('\n') });
    }
  };
}
