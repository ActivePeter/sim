'use client'

import { useState } from 'react'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
  OverflowText,
  Tooltip,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type { GetProjectAgentConfigResponse } from '@/lib/api/contracts/vscode-agents'
import type { ProjectAgentConfig, ProjectAgentSettings } from '@/lib/vibe-vscode/agent-config'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

interface ProjectAgentControlsProps {
  data?: GetProjectAgentConfigResponse
  loadError: Error | null
  saving: boolean
  hasMessages: boolean
  onRefresh(): void
  onSave(settings: ProjectAgentSettings, expectedRevision: number): Promise<unknown>
}

/** Composer-adjacent controls project the server's catalog and save to the native runtime binding. */
export function ProjectAgentControls({
  data,
  loadError,
  saving,
  hasMessages,
  onRefresh,
  onSave,
}: ProjectAgentControlsProps) {
  const { canEdit } = useUserPermissionsContext()
  const [draft, setDraft] = useState<ProjectAgentConfig | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const currentAgent = data?.agents.find((agent) => agent.id === data.config.agentId)
  const draftAgent = data?.agents.find((agent) => agent.id === draft?.agentId)
  const agentLocked = hasMessages || data?.agentLocked
  const options =
    data?.agents.map((agent) => ({
      value: agent.id,
      label: agent.label + (agent.available ? '' : ' · 未配置'),
      disabled: !agent.available,
    })) ?? []
  const save = async (settings: ProjectAgentSettings, revision: number, close: boolean) => {
    if (saving || !canEdit) return
    setSaveError(null)
    try {
      await onSave(settings, revision)
      if (close) setDraft(null)
    } catch (error) {
      setSaveError(getErrorMessage(error, 'Agent 配置保存失败'))
    }
  }

  if (!data) {
    return (
      <div className='flex min-w-0 flex-wrap items-center gap-1 text-caption'>
        <span role={loadError ? 'alert' : 'status'}>
          {loadError ? loadError.message : '读取 Agent 配置…'}
        </span>
        {loadError && <Chip onClick={onRefresh}>重试</Chip>}
      </div>
    )
  }

  return (
    <div className='flex min-w-0 flex-wrap items-center gap-1'>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span>
            <ChipSelect
              aria-label='切换项目 Agent'
              value={data.config.agentId}
              options={options}
              disabled={!canEdit || saving || agentLocked}
              onChange={(value) => {
                const agent = data.agents.find((item) => item.id === value && item.available)
                if (!agent || agent.id === data.config.agentId) return
                void save(
                  {
                    agentId: agent.id,
                    model: null,
                    reasoningEffort: null,
                    instructions: data.config.instructions,
                  },
                  data.config.revision,
                  false
                )
              }}
            />
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content>
          {agentLocked ? '本会话已固定运行器；新建会话可切换 Agent' : '首条消息发送前可切换运行器'}
        </Tooltip.Content>
      </Tooltip.Root>
      <Chip
        aria-label='项目 Agent 配置'
        disabled={saving}
        onClick={() => {
          setSaveError(null)
          setDraft({ ...data.config })
        }}
      >
        <OverflowText
          className='max-w-[180px] text-caption'
          label={
            saving ? '保存中…' : data.config.model ? `模型：${data.config.model}` : '模型与配置'
          }
        />
      </Chip>
      {saveError && !draft && (
        <span role='alert' className='w-full break-words text-[var(--text-error)] text-caption'>
          {saveError}
        </span>
      )}
      {!currentAgent?.available && (
        <span role='alert' className='w-full text-[var(--text-error)] text-caption'>
          {currentAgent?.unavailableReason ?? '当前 Agent 不可用'}
        </span>
      )}
      <ChipModal
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !saving) setDraft(null)
        }}
        srTitle='项目 Agent 配置'
        size='md'
      >
        <ChipModalHeader
          onClose={() => {
            if (!saving) setDraft(null)
          }}
        >
          项目 Agent 配置
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='custom'
            title='Agent'
            hint={
              agentLocked
                ? '会话已绑定运行器。模型、推理和指令仍可修改，从下一轮生效。'
                : '切换 Agent 会清空不同运行器之间不兼容的模型和推理选项。'
            }
          >
            <ChipSelect
              aria-label='配置 Agent'
              fullWidth
              options={options}
              value={draft?.agentId}
              disabled={!canEdit || saving || agentLocked}
              onChange={(value) => {
                const agent = data.agents.find((item) => item.id === value && item.available)
                if (agent && draft)
                  setDraft({ ...draft, agentId: agent.id, model: null, reasoningEffort: null })
              }}
            />
          </ChipModalField>
          <ChipModalField
            type='input'
            title='模型'
            value={draft?.model ?? ''}
            onChange={(value) => draft && setDraft({ ...draft, model: value || null })}
            placeholder='留空使用运行器默认模型'
            maxLength={200}
            disabled={!canEdit || saving}
            hint='模型 ID 或别名，以该运行器账号实际支持的模型为准。凭据不在此配置。'
          />
          <ChipModalField type='custom' title='推理强度'>
            <ChipSelect
              aria-label='推理强度'
              fullWidth
              value={draft?.reasoningEffort ?? 'default'}
              disabled={!canEdit || saving}
              options={[
                { value: 'default', label: '运行器默认' },
                ...(draftAgent?.reasoningEfforts.map((effort) => ({
                  value: effort,
                  label: effort,
                })) ?? []),
              ]}
              onChange={(value) => {
                const effort = draftAgent?.reasoningEfforts.find((item) => item === value) ?? null
                if (draft) setDraft({ ...draft, reasoningEffort: effort })
              }}
            />
          </ChipModalField>
          <ChipModalField
            type='textarea'
            title='会话指令'
            value={draft?.instructions ?? ''}
            onChange={(value) => draft && setDraft({ ...draft, instructions: value })}
            maxLength={8000}
            disabled={!canEdit || saving}
            placeholder='本会话后续任务需要遵循的约定'
          />
          <ChipModalField
            type='custom'
            title='执行权限'
            hint='由部署策略决定，不会因切换模型或 Agent 提升权限。'
          >
            <span className='text-small'>{draftAgent?.permissionLabel}</span>
          </ChipModalField>
          {draft && draft.revision !== data.config.revision && (
            <ChipModalField
              type='custom'
              title='配置已更新'
              hint='其他页面已保存更新。重新载入后再编辑，避免覆盖别人的修改。'
            >
              <Chip
                disabled={saving}
                onClick={() => {
                  setDraft({ ...data.config })
                  setSaveError(null)
                }}
              >
                载入当前配置
              </Chip>
            </ChipModalField>
          )}
          <ChipModalError>{saveError}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setDraft(null)}
          cancelDisabled={saving}
          primaryAction={{
            label: saving ? '保存中…' : '保存配置',
            disabled: saving || !canEdit || !draftAgent?.available || !draft,
            onClick: () => {
              if (draft) {
                const { version: _version, revision, ...settings } = draft
                void save({ ...settings, model: settings.model?.trim() || null }, revision, true)
              }
            },
          }}
        />
      </ChipModal>
    </div>
  )
}
