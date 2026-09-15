CREATE TABLE "vscode_project_sessions" (
	"chat_id" uuid PRIMARY KEY NOT NULL,
	"host_id" text,
	"request_key" text NOT NULL,
	"origin" jsonb NOT NULL,
	"runtime_thread_id" text,
	"last_turn_id" text,
	"last_outcome" text,
	CONSTRAINT "vscode_project_sessions_request_key_unique" UNIQUE("request_key")
);
--> statement-breakpoint
CREATE TABLE "vscode_workspace_hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"physical_workspace_id" text NOT NULL,
	"remote_authority" text NOT NULL,
	"catalog" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vscode_project_sessions" ADD CONSTRAINT "vscode_project_sessions_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vscode_project_sessions" ADD CONSTRAINT "vscode_project_sessions_host_id_vscode_workspace_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."vscode_workspace_hosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vscode_workspace_hosts" ADD CONSTRAINT "vscode_workspace_hosts_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vscode_workspace_hosts" ADD CONSTRAINT "vscode_workspace_hosts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vscode_workspace_hosts_identity_idx" ON "vscode_workspace_hosts" USING btree ("workspace_id","user_id","physical_workspace_id","remote_authority");