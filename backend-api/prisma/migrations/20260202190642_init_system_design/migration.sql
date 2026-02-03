-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_specs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "spec_hash" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apis" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "path" TEXT NOT NULL,
    "operation_id" TEXT,
    "summary" TEXT,
    "auth_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_requests" (
    "id" TEXT NOT NULL,
    "api_id" TEXT NOT NULL,
    "body_schema" JSONB,
    "headers" JSONB,
    "query_params" JSONB,
    "path_params" JSONB,

    CONSTRAINT "api_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_responses" (
    "id" TEXT NOT NULL,
    "api_id" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_schema" JSONB NOT NULL,

    CONSTRAINT "api_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variables" (
    "id" TEXT NOT NULL,
    "api_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "var_type" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "ai_confidence" DOUBLE PRECISION,

    CONSTRAINT "variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dependency_candidates" (
    "id" TEXT NOT NULL,
    "source_api_id" TEXT NOT NULL,
    "target_api_id" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dependency_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_dependencies" (
    "id" TEXT NOT NULL,
    "source_api_id" TEXT NOT NULL,
    "target_api_id" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "is_required" BOOLEAN NOT NULL,

    CONSTRAINT "api_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "environment" TEXT NOT NULL,
    "trigger_source" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_executions" (
    "id" TEXT NOT NULL,
    "test_run_id" TEXT NOT NULL,
    "api_id" TEXT,
    "status" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,

    CONSTRAINT "test_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_artifacts" (
    "id" TEXT NOT NULL,
    "test_execution_id" TEXT NOT NULL,
    "request_data" JSONB,
    "response_data" JSONB,
    "response_time_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "projects_name_key" ON "projects"("name");

-- CreateIndex
CREATE UNIQUE INDEX "api_specs_project_id_spec_hash_key" ON "api_specs"("project_id", "spec_hash");

-- CreateIndex
CREATE UNIQUE INDEX "apis_project_id_method_path_key" ON "apis"("project_id", "method", "path");

-- CreateIndex
CREATE UNIQUE INDEX "api_requests_api_id_key" ON "api_requests"("api_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_responses_api_id_status_code_key" ON "api_responses"("api_id", "status_code");

-- CreateIndex
CREATE UNIQUE INDEX "variables_api_id_name_location_key" ON "variables"("api_id", "name", "location");

-- CreateIndex
CREATE UNIQUE INDEX "api_dependencies_source_api_id_target_api_id_key" ON "api_dependencies"("source_api_id", "target_api_id");

-- CreateIndex
CREATE UNIQUE INDEX "test_executions_test_run_id_api_id_key" ON "test_executions"("test_run_id", "api_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_specs" ADD CONSTRAINT "api_specs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apis" ADD CONSTRAINT "apis_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_requests" ADD CONSTRAINT "api_requests_api_id_fkey" FOREIGN KEY ("api_id") REFERENCES "apis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_responses" ADD CONSTRAINT "api_responses_api_id_fkey" FOREIGN KEY ("api_id") REFERENCES "apis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variables" ADD CONSTRAINT "variables_api_id_fkey" FOREIGN KEY ("api_id") REFERENCES "apis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependency_candidates" ADD CONSTRAINT "dependency_candidates_source_api_id_fkey" FOREIGN KEY ("source_api_id") REFERENCES "apis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependency_candidates" ADD CONSTRAINT "dependency_candidates_target_api_id_fkey" FOREIGN KEY ("target_api_id") REFERENCES "apis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_dependencies" ADD CONSTRAINT "api_dependencies_source_api_id_fkey" FOREIGN KEY ("source_api_id") REFERENCES "apis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_dependencies" ADD CONSTRAINT "api_dependencies_target_api_id_fkey" FOREIGN KEY ("target_api_id") REFERENCES "apis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_executions" ADD CONSTRAINT "test_executions_test_run_id_fkey" FOREIGN KEY ("test_run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_executions" ADD CONSTRAINT "test_executions_api_id_fkey" FOREIGN KEY ("api_id") REFERENCES "apis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_artifacts" ADD CONSTRAINT "execution_artifacts_test_execution_id_fkey" FOREIGN KEY ("test_execution_id") REFERENCES "test_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
