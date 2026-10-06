# omp-deep-research

**Gajae Code의 autoresearch에서 착안한 Oh My Pi 전용 조사 확장입니다.** 웹·로컬 데이터·실험에서 근거를 모아 구조화된 결론을 남깁니다. OMP 코어를 포크하지 않으며 기존 `/autoresearch` 명령을 변경하지 않습니다.

> 초기 버전 0.1.0입니다. 단위·어댑터 계약 테스트와 OMP 18.6.1 실제 실행 결과는 [VERIFICATION.md](docs/VERIFICATION.md)에 기록했습니다. `scripts/publish-github.sh`는 사용자가 실행할 때만 원격 저장소를 만들고 push합니다.

```text
/deep-research [--mode …]
  → (모드 없으면) intake: 목표·제약·결과물·모드 확인 → deep_research start
  → 원문 읽기 / 허용된 데이터 실험(autoresearch.sh 하네스)
  → 도구 결과 영수증 → 근거 원장
  → 선택적 critic 검토
  → conclusive / inconclusive verdict
  → 요청 시 report.md + mission.json + ledger.jsonl
```

## OMP autoresearch와의 차이

| | 기존 OMP `/autoresearch` | 이 확장 `/deep-research` |
|---|---|---|
| 목적 | 지표를 개선하는 코드 실험 | 근거를 수집해 질문에 답하기 |
| 결과 | 최적화 변경과 실험 결과 | 출처·실험 기록·구조화된 결론 |
| 제품 코드 수정 | 원래 최적화 워크플로의 일부 | 이 확장의 조사 범위 밖 |
| Git commit/revert | 원래 기능에 맡김 | 실행하지 않음 |

Gajae의 스킬이나 CLI를 그대로 복사한 호환 레이어는 아닙니다. `gjc`, `.gjc/` 상태, Gajae의 Python 커널, goal 명령에 의존하지 않습니다. 차이는 [호환성 문서](docs/COMPATIBILITY.md)에 정리했습니다.

## 1. 바로 로드하기

**OMP가 이미 설치된 환경**에서 실행합니다. 런타임 외부 npm 의존성이 없어 이 확장을 로드하기 위한 `npm install`이나 빌드는 필요 없습니다.

```bash
cd omp-deep-research
omp -e "$PWD"
```

OMP를 프로젝트 작업 디렉터리에서 실행하려면 확장 경로를 지정합니다.

```bash
cd /path/to/your-project
omp -e /absolute/path/to/omp-deep-research
```

항상 로드하려면 현재 OMP 프로필의 설정 파일에 아래 **항목을 병합**합니다. 기존 `extensions` 목록이나 설정 파일 전체를 덮어쓰지 마십시오. 기본 프로필의 사용자 설정 경로는 `~/.omp/agent/config.yml`입니다.

```yaml
extensions:
  - /absolute/path/to/omp-deep-research
```

확인한 OMP 로딩 문서: [extension-loading.md](https://github.com/can1357/oh-my-pi/blob/main/docs/extension-loading.md). 먼저 `-e`로 시험한 뒤 상시 로드를 권합니다. `skills/deep-research/SKILL.md`만 복사하면 상태 도구가 등록되지 않으므로 동작하지 않습니다.

## 2. 사용 예시

OMP 입력창에서 다음처럼 실행합니다. `--mode`를 주면 바로 시작합니다.

```text
/deep-research --mode web OMP와 Gajae Code의 최신 멀티프로바이더 지원을 공식 문서와 소스로 비교해줘
```

`--mode` 없이 실행하면 **intake**가 열립니다. 에이전트가 `ask`로 목표·제약·결과물·모드를 확인한 뒤 `deep_research(op:"start")`로 미션을 만듭니다. 그 전에는 조사 도구가 모두 차단됩니다. 모드는 파일 존재 여부로 추론하지 않습니다.

```text
/deep-research 이 프로젝트의 직렬화 방식 중 어느 쪽이 빠른지 알아봐줘
```

읽기 전용 로컬 데이터 조사:

```text
/deep-research --mode data 이 프로젝트의 기존 벤치마크 결과 파일을 읽고 병목 가설을 검토해줘
```

벤치마크 하네스로 baseline/keep/discard 실험을 반복하는 조사(Gajae autoresearch의 실험 루프):

```text
/deep-research --mode data --harness --budget 4 --max-tools 40 기존 벤치마크로 JSON 파서 두 개의 지연 시간을 비교해줘. 제품 코드는 변경하지 마.
```

**`--harness`**는 작업 디렉터리 루트의 `autoresearch.sh` 한 파일만 `write`로 쓰고, 정확히 `bash autoresearch.sh`(동기 실행, 루트 디렉터리)만 실행하도록 허용합니다. 심볼릭 링크·하드 링크된 `autoresearch.sh`는 거부합니다. 그래도 하네스 내용은 에이전트가 작성한 **임의 코드**이므로 격리 기능이 아닙니다.

**`--allow-exec`는 임의 코드 실행 권한입니다.** OMP의 `bash`·`eval`을 모두 허용합니다. 두 옵션 모두 `data`/`mixed` 모드 전용입니다. 별도 작업 복사본이나 컨테이너에서 사용하고, 기존 OMP 승인 절차를 유지하십시오.

## 3. 명령과 예산

| 명령/옵션 | 동작 |
|---|---|
| `/deep-research <objective>` | intake 시작. 에이전트가 확인 후 `start` 호출 |
| `/deep-research --mode … <objective>` | 명시한 모드로 미션 즉시 시작 |
| `/deep-research` 또는 `help` | 사용법만 표시. 자동으로 조사하지 않음 |
| `/deep-research status` | 목표, 현재 상태, 출처 수, 예산, 마지막 결론, 대기 중인 intake |
| `/deep-research pause` | 현재 패스를 일시중지하고 중단 요청 |
| `/deep-research resume` | 근거와 이전 결론을 유지하며 새 예산의 패스 시작 |
| `/deep-research cancel` | 미션 또는 intake 취소. 자동 재시작 없음 |
| `/deep-research clear` | 현재 미션(또는 intake)을 논리적으로 정리. 원장은 삭제하지 않음 |
| `/deep-research export` | 새로운 로컬 폴더에 Markdown·JSON·JSONL 저장 |
| `--mode web\|data\|mixed` | 생략하면 intake. 파일 존재 여부로 모드를 추론하지 않음 |
| `--harness` | data/mixed 전용. `./autoresearch.sh` 작성과 `bash autoresearch.sh` 실행만 허용 |
| `--allow-exec` | data/mixed 전용. `bash`·`eval` 전체 허용 |
| `--budget 0..8` | 패스당 추가 자동 이어가기 요청 수. 기본 6 |
| `--max-tools 1..1000` | 패스당 부모 세션의 자료 수집 도구 호출 한도. 기본 60 |
| `--max-minutes 1..240` | 패스의 경과 시간 제한. 기본 20분 |
| `--critic provider/model` | 사용 가능한 별도 평가 모델 지정. 임의 대체하지 않음 |
| `--constraint "..."` | 제약 추가. 반복 지정 가능 |
| `--deliverable "..."` | 산출물 요구 추가. 반복 지정 가능 |

`--budget`은 전체 모델 호출 횟수나 토큰·요금 상한이 아닙니다. 시간·도구 예산은 부모 도구 호출/종료 경계에서 검사하며, 실행 중인 긴 명령을 강제 종료하지 않습니다. `task`의 자식 호출 하나하나를 합산하지도 않습니다. 미션이 중단되거나 예산을 소진했을 때 결론을 저장하지 못했다면, 이를 완료로 위장하지 않고 `paused`로 남깁니다.

`resume`은 사용자의 명시적인 새 실행 요청입니다. 기존 패스의 자동 무한 연장이나 OMP 종료 후 백그라운드 실행이 아닙니다.

## 4. 에이전트가 사용하는 도구

등록되는 도구 이름은 충돌을 줄이기 위해 `deep_research` 하나입니다.

| `op` | 내용 |
|---|---|
| `read` | 요약, 전체 미션, 최근 도구 영수증, critic 브리프. `view: "summary"\|"full"\|"receipts"\|"critic"` |
| `start` | 대기 중인 intake를 확인된 목표·모드·제약·결과물로 미션으로 전환. 예산·실행 권한은 변경 불가 |
| `evidence` | 원문 읽기 결과와 연결된 근거 추가. 같은 출처·주장·stance는 중복 제거 |
| `run` | 실제 출력의 `METRIC`으로 baseline/keep/discard/crash/checks_failed 기록 |
| `flag_run` | 부정확하거나 조작된 실험 제외, 최선 지표 재계산 |
| `notes` | 가설·관찰·다음 시도를 보존 |
| `critic` | 검토자, 결과 영수증, 검토한 근거 집합, 우려사항 기록 |
| `verdict` | 출처에 연결된 findings와 caveats를 갖춘 결론 저장 |
| `export` | 로컬 산출물 명시적 생성 |

웹 근거에는 URL을 직접 연 `read` 영수증과 관측된 URL이 필요합니다. 검색 스니펫, `github` 결과, 하위 에이전트의 요약은 단서일 뿐 원문 확인을 대체할 수 없습니다. 실제 출처의 진실성이나 주장과의 논리적 부합성까지 자동 증명하는 것은 아닙니다.

미션이 활성인 동안 부모 세션 도구 정책(OMP 18.6.x 기준 이름):

| 분류 | 도구 |
|---|---|
| 항상 허용, 예산 미차감 | `deep_research`, `ask`, `todo`, `wait`, `think` |
| 허용, 예산 차감 | `read`, `grep`, `find`, `glob`, `ast_grep`, `web_search`, `recall`, 읽기 전용 `github` op, `agent:"scout"` `task` |
| `data` 모드에서 차단 | `web_search`, `github`, URL 경로를 가진 모든 도구 호출(`read`, `grep` 등은 URL을 직접 가져옴) |
| `--harness`(data/mixed)에서만 허용 | 루트 `autoresearch.sh`로의 `write`, 정확히 `bash autoresearch.sh` |
| `--allow-exec`(data/mixed)에서만 허용 | `bash`, `eval`, 루트 `autoresearch.sh`로의 `write` |
| 그 외 전부 차단 | `edit`, `ast_edit`, 그 밖의 `write`, `lsp`, `goal`, 알 수 없는 도구 등 |

intake 중에는 위 표와 무관하게 `deep_research`, `ask`, `todo`, `wait`, `think`만 허용됩니다.

쓰기에 `requestId`를 지정하면 동일 입력 재시도가 멱등 처리됩니다. 이미 결론을 저장한 뒤 응답이 유실되어 같은 요청을 반복해도 결론을 중복 저장하지 않습니다. 다른 입력에 같은 ID를 재사용하면 거부합니다.

## 5. 실험과 critic

`run`은 실험을 직접 실행하지 않습니다. `--harness`의 `bash autoresearch.sh`나 허용된 다른 도구로 실행한 결과가 아래와 같은 출력을 남겨야 합니다. 하네스는 실패 시 0이 아닌 종료 코드를 내야 하며(OMP가 오류 결과로 기록 → `crash`), 고정 시드·고정 작업량으로 결정적이어야 합니다.

```text
METRIC latency_ms=128.4
METRIC memory_mb=241
```

주요 지표와 방향은 첫 실행부터 미션 내에서 고정됩니다. 지표가 엄격히 개선되면 `keep`, 동률·악화면 `discard`입니다. 이는 통계적 유의성을 의미하지 않으며 코드 commit/revert를 수행하지도 않습니다. 잘못된 지표, 실행 오류, 검사 실패는 유효한 최선 실험에 포함하지 않습니다.

기본 조사 모델은 OMP의 현재 모델입니다. `--critic`을 지정하면 모델 선택자를 OMP의 공개 모델 조회 API로 해석합니다. 메인 모델과 같은 모델이거나 사용 불가능한 선택자는 미션 시작 전에 거부합니다. 메인 에이전트는 `deep_research(op:"read", view:"critic")`의 critic 브리프(지시문 + 전체 근거·실험 스냅샷 + 다이제스트)를 읽기 전용 `scout`에 그 모델로 전달합니다. 지시문은 Gajae `auto-critic.md`를 이 확장의 `critic` 기록 형식에 맞게 고친 것입니다. 사용자 환경에 `scout`이나 해당 모델이 없다면 임의 코딩 에이전트/모델로 대체하지 않습니다.

Critic은 현재의 **전체 근거·실험 스냅샷**을 검토해야 합니다. 이후 근거나 실험 유효성이 바뀌면 기존 검토는 무효가 됩니다. 지정된 critic의 유효한 `pass` 없이 `conclusive`를 기록하지 못하지만, 한계를 밝힌 `inconclusive`는 허용합니다. 별도 모델 호출의 독립성을 암호학적으로 입증하는 시스템은 아닙니다.

## 6. 상태와 파일

권위 있는 원장은 OMP 세션의 활성 브랜치에 기록되는 custom entry입니다.

```text
io.github.hoon-ch.omp-deep-research.event.v1
```

이벤트를 읽을 때마다 현재 `getBranch()`에서 복원하므로 세션 전환·브랜치 이동·compaction 뒤에도 다른 브랜치의 근거를 섞지 않습니다. 내부 상태를 전역 변수나 별도 `.gjc/` 파일에 저장하지 않습니다. 영구 보관 여부는 OMP 세션 저장 방식에 따릅니다.

내보내기를 요청하면 작업 디렉터리에 아래 파일이 생깁니다.

```text
.omp/deep-research/<mission-id>-<export-id>/
  report.md
  mission.json
  ledger.jsonl
```

기존 파일을 덮어쓰지 않으며 심볼릭 링크로 된 내보내기 상위 디렉터리를 거부합니다. 세션 기록과 보고서에는 비공개 내용이 포함될 수 있습니다. 자동 commit·전송·텔레메트리는 없습니다. `clear`는 보안 삭제 기능이 아닙니다.

## 7. 테스트

런타임 외부 의존성이 없으므로 테스트 자체는 Node.js 22.6 이상에서 바로 실행됩니다.

```bash
npm test
```

타입 검사까지 포함한 개발 검증:

```bash
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

GitHub Actions에는 Node 22/24용 CI 정의를 포함했습니다. **CI를 원격에서 실행했다는 뜻은 아닙니다.** 실제 검증 범위와 남은 OMP 실기 테스트는 [VERIFICATION.md](docs/VERIFICATION.md)를 확인하십시오.

## 8. hoon-ch GitHub 저장소 생성·업로드

현재 소스에는 원격 인증정보가 없습니다. GitHub CLI가 로그인된 사용자 환경에서 다음을 실행하면 `hoon-ch/omp-deep-research`를 생성하고 초기 커밋을 push합니다.

```bash
bash scripts/publish-github.sh --dry-run
bash scripts/publish-github.sh
```

**기본 공개 범위는 private**입니다. 공개 저장소를 의도적으로 만들 때만 `--public`을 전달합니다.

스크립트는 로그인 계정이 `hoon-ch`인지 확인합니다. 같은 원격 저장소 또는 로컬 remote가 이미 있으면 덮어쓰지 않고 중단합니다. 토큰을 받거나 출력하지 않으며 force-push하지 않습니다. 부분 실패 후 이미 원격 저장소가 만들어진 상태라면 재실행으로 강제 복구하지 말고 GitHub 상태를 먼저 확인하십시오.

## 설계 문서

- [아키텍처](docs/ARCHITECTURE.md)
- [OMP API 호환성과 원본 매핑](docs/COMPATIBILITY.md)
- [실행한 검증과 남은 검증](docs/VERIFICATION.md)
- [보안·개인정보 경계](SECURITY.md)
- [원본 출처와 MIT 고지](THIRD_PARTY_NOTICES.md)
