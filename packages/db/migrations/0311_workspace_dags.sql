CREATE TABLE "workspace_dag" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"document" jsonb NOT NULL,
	"legacy_file_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_dag_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "workspace_dag_legacy_file_id_unique" UNIQUE("legacy_file_id"),
	CONSTRAINT "workspace_dag_document_identity" CHECK (("workspace_dag"."document"->>'id' = "workspace_dag"."id" AND "workspace_dag"."document"->>'kind' = 'dag') IS TRUE)
);
--> statement-breakpoint
ALTER TABLE "workspace_dag" ADD CONSTRAINT "workspace_dag_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_dag" ADD CONSTRAINT "workspace_dag_legacy_file_id_workspace_files_id_fk" FOREIGN KEY ("legacy_file_id") REFERENCES "public"."workspace_files"("id") ON DELETE set null ON UPDATE no action;
