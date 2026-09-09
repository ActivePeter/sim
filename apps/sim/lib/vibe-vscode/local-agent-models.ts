import {
  type ProjectAgentId,
  type ProjectAgentModel,
  type ProjectAgentModelCatalog,
  projectAgentModelsSchema,
} from '@/lib/vibe-vscode/agent-config'
import { getLocalClaudeModels } from '@/lib/vibe-vscode/local-claude'
import { getLocalCodexModels } from '@/lib/vibe-vscode/local-codex'

const MODEL_CATALOG_TTL_MS = 5 * 60_000

interface CatalogEntry {
  expiresAt: number
  result: Promise<ProjectAgentModelCatalog>
}

/** One in-flight query per installed runtime; failures stay retryable and are never empty catalogs. */
export class LocalAgentModelCatalogReader {
  private readonly entries = new Map<ProjectAgentId, CatalogEntry>()

  constructor(
    private readonly discover: (agentId: ProjectAgentId) => Promise<ProjectAgentModel[]>,
    private readonly now: () => number = Date.now
  ) {}

  read(agentId: ProjectAgentId): Promise<ProjectAgentModelCatalog> {
    const cached = this.entries.get(agentId)
    if (cached && cached.expiresAt > this.now()) return cached.result

    const result = Promise.resolve()
      .then(() => this.discover(agentId))
      .then((models): ProjectAgentModelCatalog => {
        const catalog: ProjectAgentModelCatalog = {
          status: 'ready',
          models: projectAgentModelsSchema.parse(models),
        }
        entry.expiresAt = this.now() + MODEL_CATALOG_TTL_MS
        return catalog
      })
      .catch((): ProjectAgentModelCatalog => {
        if (this.entries.get(agentId) === entry) this.entries.delete(agentId)
        return {
          status: 'error',
          message: '模型目录读取失败，请重试并检查运行器版本及鉴权。仍可使用运行器默认配置。',
        }
      })
    const entry: CatalogEntry = { expiresAt: Number.POSITIVE_INFINITY, result }
    this.entries.set(agentId, entry)
    return result
  }
}

/** Deployment-owned executables and credential homes are stable for this server process's lifetime. */
export const localAgentModelCatalogs = new LocalAgentModelCatalogReader((agentId) =>
  agentId === 'local-codex' ? getLocalCodexModels() : getLocalClaudeModels()
)
