CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text,
	"system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"summary" text,
	"data" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"name" text NOT NULL,
	"bank_name" text,
	"bank_address" text,
	"routing_enc" text,
	"account_enc" text,
	"last4" text,
	"next_check_number" integer DEFAULT 1001 NOT NULL,
	"layout" text DEFAULT 'top' NOT NULL,
	"stock" text DEFAULT 'preprinted' NOT NULL,
	"offset_x" numeric(5, 3) DEFAULT '0' NOT NULL,
	"offset_y" numeric(5, 3) DEFAULT '0' NOT NULL,
	"micr_font_doc_id" integer,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_id" integer NOT NULL,
	"project_id" integer,
	"category_id" integer NOT NULL,
	"description" text,
	"amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"kind" text DEFAULT 'vendor' NOT NULL,
	"internal_no" text,
	"vendor_id" integer,
	"payee" text,
	"project_id" integer,
	"bill_no" text,
	"date" date NOT NULL,
	"due_date" date,
	"total" numeric(14, 2) NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(14, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"entry_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"mime" text NOT NULL,
	"storage_key" text NOT NULL,
	CONSTRAINT "blobs_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	"kind" text NOT NULL,
	"account_id" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"budget_change" numeric(14, 2) DEFAULT '0' NOT NULL,
	"price_change" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_apps" (
	"id" serial PRIMARY KEY NOT NULL,
	"check_id" integer NOT NULL,
	"bill_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"bank_account_id" integer NOT NULL,
	"number" integer NOT NULL,
	"date" date NOT NULL,
	"payee" text NOT NULL,
	"payee_address" text,
	"amount" numeric(14, 2) NOT NULL,
	"memo" text,
	"vendor_id" integer,
	"project_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"payment_id" integer,
	"print_count" integer DEFAULT 0 NOT NULL,
	"printed_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"cleared_at" date,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"phone" text,
	"email" text,
	"address" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"email" text,
	"logo_doc_id" integer,
	"payment_instructions" text,
	"invoice_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"blob_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"folder" text DEFAULT 'Miscellaneous' NOT NULL,
	"tags" text,
	"version_group" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"uploaded_by" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"taxable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"number" text NOT NULL,
	"client_id" integer NOT NULL,
	"project_id" integer,
	"date" date NOT NULL,
	"due_date" date,
	"tax_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"amount_paid" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"payment_instructions" text,
	"status" text DEFAULT 'open' NOT NULL,
	"entry_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"entry_no" integer NOT NULL,
	"date" date NOT NULL,
	"memo" text,
	"source_type" text NOT NULL,
	"source_id" integer,
	"reverses_id" integer,
	"posted_by" integer,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"project_id" integer,
	"vendor_id" integer,
	"client_id" integer,
	"category_id" integer,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"waiver_types" jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "lien_waivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"payment_id" integer,
	"type" text NOT NULL,
	"amount" numeric(14, 2),
	"payment_date" date,
	"status" text DEFAULT 'requested' NOT NULL,
	"received_date" date,
	"document_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mileage_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"effective_from" date NOT NULL,
	"rate" numeric(6, 4) NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "mileage_trips" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"date" date NOT NULL,
	"origin" text,
	"destination" text,
	"purpose" text NOT NULL,
	"project_id" integer,
	"vehicle_id" integer,
	"odo_start" numeric(9, 1),
	"odo_end" numeric(9, 1),
	"miles" numeric(8, 1) NOT NULL,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overhead_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"bill_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"method" text NOT NULL,
	"basis" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_apps" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" integer NOT NULL,
	"bill_id" integer,
	"invoice_id" integer,
	"amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"direction" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"method" text NOT NULL,
	"account_id" integer NOT NULL,
	"vendor_id" integer,
	"client_id" integer,
	"reference" text,
	"memo" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"entry_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"number" text NOT NULL,
	"address" text,
	"client_id" integer,
	"jurisdiction_id" integer,
	"start_date" date,
	"est_completion" date,
	"actual_completion" date,
	"status" text DEFAULT 'active' NOT NULL,
	"budget" numeric(14, 2) DEFAULT '0' NOT NULL,
	"contract_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recon_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"reconciliation_id" integer NOT NULL,
	"journal_line_id" integer NOT NULL,
	CONSTRAINT "recon_items_journal_line_id_unique" UNIQUE("journal_line_id")
);
--> statement-breakpoint
CREATE TABLE "reconciliations" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"bank_account_id" integer NOT NULL,
	"statement_date" date NOT NULL,
	"beginning_balance" numeric(14, 2) NOT NULL,
	"ending_balance" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" integer
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"company_id" integer NOT NULL,
	"key" text NOT NULL,
	"next" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sequences_company_id_key_pk" PRIMARY KEY("company_id","key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"can_print_checks" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'vendor' NOT NULL,
	"contact" text,
	"phone" text,
	"email" text,
	"address" text,
	"trade" text,
	"tax_id_enc" text,
	"tax_id_last4" text,
	"is_1099" boolean DEFAULT false NOT NULL,
	"requires_waiver" boolean DEFAULT false NOT NULL,
	"insurance_expires" date,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_apps" ADD CONSTRAINT "check_apps_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_apps" ADD CONSTRAINT "check_apps_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_blob_id_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lien_waivers" ADD CONSTRAINT "lien_waivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lien_waivers" ADD CONSTRAINT "lien_waivers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lien_waivers" ADD CONSTRAINT "lien_waivers_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lien_waivers" ADD CONSTRAINT "lien_waivers_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mileage_rates" ADD CONSTRAINT "mileage_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mileage_trips" ADD CONSTRAINT "mileage_trips_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mileage_trips" ADD CONSTRAINT "mileage_trips_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mileage_trips" ADD CONSTRAINT "mileage_trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_allocations" ADD CONSTRAINT "overhead_allocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_allocations" ADD CONSTRAINT "overhead_allocations_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_allocations" ADD CONSTRAINT "overhead_allocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_items" ADD CONSTRAINT "recon_items_reconciliation_id_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."reconciliations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_items" ADD CONSTRAINT "recon_items_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_code" ON "accounts" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "audit_entity" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "bl_bill" ON "bill_lines" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "bills_vendor" ON "bills" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "bills_project" ON "bills" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_internal_no" ON "bills" USING btree ("company_id","internal_no");--> statement-breakpoint
CREATE UNIQUE INDEX "checks_number" ON "checks" USING btree ("bank_account_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "dl_unique" ON "document_links" USING btree ("document_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "dl_entity" ON "document_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number" ON "invoices" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "je_date" ON "journal_entries" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "je_source" ON "journal_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "jl_entry" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "jl_account" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "jl_project" ON "journal_lines" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mr_unique" ON "mileage_rates" USING btree ("company_id","effective_from");--> statement-breakpoint
CREATE INDEX "pa_bill" ON "payment_apps" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "pa_invoice" ON "payment_apps" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "pa_payment" ON "payment_apps" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pb_unique" ON "project_budgets" USING btree ("project_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_number" ON "projects" USING btree ("company_id","number");