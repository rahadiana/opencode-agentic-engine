# Multi-Agent Orchestration

## Agent Roles

| Role | Fungsi | Tools Utama |
|------|--------|-------------|
| **PM** | Product Manager: breakdown requirements, prioritasi | `agentic_plan` |
| **Architect** | Arsitektur, component design, dependency analysis | `agentic_plan`, `agentic_score` |
| **Developer** | Implementasi kode | `agentic_execute`, `edit`, `write` |
| **QA** | Testing, verification, security audit | `agentic_verify`, `agentic_guard` |
| **Coordinator** | Pipeline orchestration, cross-validation | `agentic_pipeline`, `agentic_message` |

## Delegation

Assign task ke specialist agent dengan `agentic_delegate`:

```
agentic_delegate taskId="auth-1" description="Desain arsitektur auth module" role=architect
agentic_delegate taskId="auth-2" description="Implementasi JWT middleware" role=developer
agentic_delegate taskId="auth-3" description="Test coverage auth module" role=qa
```

Setiap role otomatis:
1. Inject context dari task sebelumnya
2. Cross-validation antar stage
3. Inter-agent messaging untuk review

## Pipeline

Multi-agent workflow pipeline: PM → Architect → Developer → QA.

```
agentic_pipeline suggest description="Buat fitur registrasi user"
  → Auto-generate stages:
     Stage 1: PM  → breakdown requirements
     Stage 2: Architect → design API + database schema
     Stage 3: Developer → implementasi
     Stage 4: QA  → test + security audit

agentic_pipeline define pipelineId="reg-1" stages=[
  { role: "pm", description: "Buat user stories", validationCriteria: ["semua use case tercover"] },
  { role: "architect", description: "Design API endpoints", validationCriteria: ["RESTful", "error handling"] },
  { role: "developer", description: "Implementasi API", validationCriteria: ["compile success", "test >80%"] },
  { role: "qa", description: "Integration test", validationCriteria: ["all tests pass", "security scan"] }
]

agentic_pipeline run pipelineId="reg-1"
```

## Inter-Agent Messaging

Agents bisa saling kirim pesan, review request, approval:

```
agentic_message action="send" to="qa" taskId="auth-2" type="review_request"
  message="Tolong review JWT middleware yang sudah selesai"

agentic_message action="inbox"
  → Lihat pesan masuk

agentic_message action="conversation" taskId="auth-2"
  → Lihat thread percakapan

agentic_message action="send" to="developer" taskId="auth-2" type="approval"
  message="LGTM, lanjut ke step berikutnya"
```

Message types:
| Type | Deskripsi |
|------|-----------|
| `result` | Task result notification |
| `review_request` | Minta review ke downstream role |
| `review_response` | Hasil review |
| `clarification` | Butuh klarifikasi |
| `approval` | Setuju untuk lanjut |
| `revision` | Minta revisi |

## Parallel Execution

Steps independen bisa jalan bareng:

```
agentic_parallel analyze
  → Tampilin phases (step yang bisa parallel)

agentic_parallel execute
  → Jalanin semua step ready dalam satu phase
```

Conflict detection: dua step yang modify file yang sama tidak bisa parallel.
