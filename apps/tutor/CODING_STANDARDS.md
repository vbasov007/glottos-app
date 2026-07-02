# Coding Standards & Architecture Guide

> Include this file in any project's `CLAUDE.md` to enforce these standards:
> `See CODING_STANDARDS.md for all coding, architecture, and testing rules. Follow them strictly.`

---

## 1. Core Philosophy

### 1.1 No Broken Windows

Never leave bad code, poor design, or wrong decisions unfixed. Every "broken window" accelerates software rot. If you cannot fix it immediately, board it up: comment out the offending code, add a `// TODO:` with context, or return a "Not Implemented" placeholder. Never let entropy spread silently.

### 1.2 Think Before You Code

Do not program by coincidence. Every line of code must exist for a reason you can articulate. If you cannot explain **why** something works, you do not understand it well enough to ship it. Rely only on documented behavior, not on happy accidents.

### 1.3 Good Design Is Easier to Change (ETC)

Every design decision must serve changeability. When choosing between two approaches, pick the one that makes future changes easier. This is the meta-principle behind DRY, decoupling, SRP, and orthogonality — they all exist because they make code easier to change.

### 1.4 Take Small Steps — Always

Build incrementally. Check feedback. Adjust before proceeding. Never write large blocks of code without verifying each piece works. Avoid fortune-telling — only look ahead as far as you can see.

---

## 2. DRY — Don't Repeat Yourself

**Every piece of knowledge must have a single, unambiguous, authoritative representation within the system.**

DRY is not just about copy-pasted code. It applies to knowledge, intent, and documentation.

### Types of Duplication to Eliminate

| Type | Cause | Solution |
|---|---|---|
| **Imposed** | External standards, frameworks | Code generators, metadata, derive from single source |
| **Inadvertent** | Poor design, incomplete data model | Fix the model; normalize the representation |
| **Impatient** | Time pressure, shortcuts | Discipline — the shortcut now costs 10x later |
| **Inter-developer** | Lack of communication | Strong team conventions, shared utilities, code review |

### Rules

- If you change knowledge in one place and must remember to change it elsewhere, it is a DRY violation
- Documentation should be built in, not bolted on — comments that restate code are duplication
- Configuration, schema, and API contracts should each have one source of truth

---

## 3. Orthogonality & Decoupling

### 3.1 Orthogonal Design

Components must be self-contained, independent, and single-purpose. The test: **changing component A must not require changing component B**.

- Use layers of abstraction where each layer only depends on the layer directly below
- Eliminate effects between unrelated things
- Avoid vendor lock-in by abstracting external dependencies behind interfaces

### 3.2 Decoupling Rules

- **Law of Demeter**: A module communicates only with its immediate neighbors. No reaching through objects to access their internals.
- **Tell, Don't Ask**: Make objects do the work instead of extracting their data, transforming it externally, and pushing it back.
- **Don't Chain Method Calls**: Avoid more than one dot when accessing something (`a.getB().getC().doThing()` is a coupling chain).
- **Avoid Global Data**: Every global is an implicit parameter to every function. If something must be global, wrap it in an API.
- **Don't Hoard State**: Pass data through; don't accumulate it in modules.
- **Prefer Interfaces for Polymorphism**: Use interfaces over inheritance. Has-A trumps Is-A. Use delegation and composition.
- **Parameterize via External Configuration**: Environment and customer-specific values live outside the code. Policy is metadata.

---

## 4. Clean Architecture

### 4.1 The Dependency Rule

**Source code dependencies must only point inward.** Nothing in an inner layer may reference anything from an outer layer — no function names, class names, or data formats from outer circles.

```
[Frameworks & Drivers] → [Interface Adapters] → [Use Cases] → [Entities]
        outer                                                     inner
```

Data crossing boundaries must use simple structures (DTOs, value objects) in the format most convenient for the **inner** layer.

### 4.2 Layer Responsibilities

**Entities (Domain Layer)**
- Core business rules and logic
- Pure business objects with no external dependencies
- Least likely to change when UI, database, or frameworks change
- Contains: Entities, Value Objects, Domain Events, Domain Exceptions, Repository Interfaces

**Use Cases (Application Layer)**
- Application-specific business rules
- Orchestrate data flow to/from entities
- Each use case has a single responsibility
- Handle expected errors gracefully
- Contains: Commands, Queries, Event Handlers, Abstractions for external services

**Interface Adapters**
- Convert data between use case format and external format
- Contains: Controllers, Presenters, Gateways, ViewModels
- All MVC/API routing logic lives here
- All database-specific code (SQL, ORM mappings) lives here

**Frameworks & Drivers**
- Outermost glue code
- Web frameworks, database engines, UI frameworks
- Minimal custom code — only wiring

### 4.3 Boundary Crossing via Dependency Inversion

When inner layers need outer layer services:

1. Inner layer defines an **interface** (port)
2. Outer layer **implements** that interface (adapter)
3. A composition root (Main, startup config) wires concrete implementations via dependency injection

Never let framework types leak into business logic.

### 4.4 Mistakes to Avoid

- **Overengineering**: Do not apply full Clean Architecture to trivial projects. Scale the architecture to the problem.
- **Ignoring the Business Domain**: Technical layering without understanding business requirements produces beautiful but useless code.
- **Unclear Boundaries**: Blurred layers destroy adaptability. Be strict about what code belongs where.
- **Database Code in Business Logic**: SQL, ORM queries, and persistence concerns must never appear in entities or use cases.
- **Performance Blindness**: Don't abstract so aggressively that queries become inefficient. Architecture serves the product, not the other way around.

---

## 5. SOLID Principles (Applied)

### Single Responsibility Principle (SRP)
Each module, class, or function has exactly **one reason to change**. If you describe what a component does and use the word "and", consider splitting it.

### Open/Closed Principle (OCP)
Software entities should be open for extension but closed for modification. Add new behavior by adding new code, not by changing existing code.

### Liskov Substitution Principle (LSP)
Subtypes must be substitutable for their base types without altering program correctness. If overriding a method changes the expected contract, the hierarchy is wrong.

### Interface Segregation Principle (ISP)
No client should be forced to depend on methods it does not use. Create specific, focused interfaces. Name interfaces after their specific use case (e.g., `UserRegisterGateway` not generic `UserGateway`).

### Dependency Inversion Principle (DIP)
High-level modules must not depend on low-level modules. Both should depend on abstractions. Abstractions must not depend on details — details depend on abstractions.

---

## 6. Design by Contract

Every function operates under an explicit contract:

- **Preconditions**: What must be true before the function is called (caller's responsibility)
- **Postconditions**: What the function guarantees upon completion
- **Invariants**: What must remain true throughout the object's lifetime

### Rules
- Be strict in what you accept (preconditions), promise only what you can deliver (postconditions)
- Document contracts in function signatures, type annotations, and validation
- Use assertions to enforce contracts — leave them active in production
- **Crash early**: A dead program does less damage than a limping one producing corrupt data

---

## 7. Error Handling & Resource Management

### Error Handling
- Use exceptions only for truly exceptional situations, not for control flow
- Provide facilities for handling regular operational failures without exceptions
- When something impossible happens: **crash immediately** with a clear error message
- Read the error message — most exceptions tell you both what failed and where

### Resource Management
- **Finish What You Start**: The function/object that allocates a resource deallocates it
- Keep the scope of mutable variables and open resources short and visible
- Use language-provided resource management patterns (`using`, `with`, `try-with-resources`, RAII)

### Assertions
- Use assertions to check for things that "can never happen"
- Assertions document and enforce your assumptions
- Never remove assertions from production code — the impossible happens regularly in production

---

## 8. Concurrency

- **Break Temporal Coupling**: Don't assume operations must happen in a fixed order. Analyze workflows to find what can run concurrently.
- **Shared State Is Incorrect State**: Avoid shared mutable state. When you must share, synchronize access explicitly.
- **Random Failures Are Often Concurrency Issues**: Intermittent, irreproducible bugs should trigger concurrency investigation.
- **Use Actors**: Process messages asynchronously with private state — no explicit locks needed.
- **Use Blackboards**: Let independent components post and retrieve data without knowing about each other.

---

## 9. Refactoring

### When to Refactor
- You discover **duplication** (DRY violation)
- You find **non-orthogonal** design (changing one thing breaks another)
- **Knowledge has changed** (requirements, understanding evolved)
- **Performance** needs improvement
- **Usage patterns** have shifted from original design assumptions

### How to Refactor Safely
- Refactor **early and often** — it is a daily activity, not a scheduled event
- Take **small, low-risk steps** — one change at a time
- **Run tests after every change** — never refactor without a safety net of automated tests
- Do not add functionality while refactoring — change structure OR behavior, never both simultaneously
- If tests don't exist, write them before refactoring

---

## 10. Naming

- **Name to express intent**: Names communicate purpose to human readers
- **Rename when needed**: When intent shifts, the name must follow immediately
- Use a **project glossary**: Maintain a single source of truth for domain-specific terms
- Program close to the **problem domain**: Use the language of the business, not implementation jargon

---

## 11. Testing Strategy

### 11.1 Core Testing Principles

- **Test early, test often, test automatically** — tests that run with every build are non-negotiable
- **Coding isn't done until all tests pass**
- **Testing shows the presence of defects, not their absence** — passing tests don't prove correctness
- **A test is the first user of your code** — use test feedback to guide design
- **Find bugs once** — when a human finds a bug, write an automated test immediately so no human ever finds it again
- **Design to test** — think about testing before writing the first line

### 11.2 Testing Pyramid (Clean Architecture)

**Domain/Entity Tests (Unit)**
- Test business rules in complete isolation
- Must be pure and fast — **no mocks, no infrastructure**
- Validate entity behavior, value objects, domain events

**Use Case Tests (Unit/Integration)**
- Test application logic
- Mock only external boundaries (repositories, external services)
- Verify orchestration, error handling, edge cases

**Infrastructure Tests (Integration)**
- Verify actual integration against real systems (database, API, file system)
- Test repository implementations with real databases
- Test external service adapters with real (or sandboxed) endpoints

**API/Presentation Tests (End-to-End)**
- Thin tests: verify routing, serialization, contracts
- Do not re-test business rules already covered by inner layers

### 11.3 Testing Anti-Patterns to Avoid

| Anti-Pattern | Why It's Bad |
|---|---|
| Mocking database context everywhere | Hides real integration issues; tests pass but production breaks |
| Replacing unit tests with integration tests | Slow, brittle, poor fault isolation |
| Tests coupled to HTTP models | Break on every API change; should test behavior, not wire format |
| Massive test setup code | Signals poor design — refactor the code, not the test |
| Tests that break on simple refactors | Tests are coupled to implementation, not behavior |
| Testing code coverage instead of state coverage | 100% line coverage doesn't mean meaningful scenarios are tested |

### 11.4 Test Types to Use

**Property-Based Tests**: Validate assumptions by exercising code with generated inputs. These find edge cases you never thought to test.

**Boundary Value Analysis**: Test at and near boundaries of input domains using:
- **On points**: Values exactly on the boundary
- **Off points**: COOOOI Rule — Closed boundary: off-point outside. Open boundary: off-point inside.

**Exploratory Testing**: Use for new features to discover edge cases, then convert findings into scripted regression tests.

**Saboteur Testing**: Intentionally introduce bugs in a copy of the source to verify your test suite catches them.

### 11.5 Shift-Left Testing

- Involve testing from the requirements phase, not after coding
- Incorporate tests in CI/CD pipelines
- Use TDD (Test-Driven Development): write the failing test first, then the minimal code to pass
- Fixing a defect in production costs 10x more than catching it during development

---

## 12. Tracer Bullets & Prototypes

### Tracer Bullets (Keep the Code)
Use when you need to build something end-to-end under real conditions:

1. Build a thin skeleton connecting all layers (UI to database)
2. Get immediate feedback under real conditions
3. Add features one use case at a time
4. The tracer code evolves into the final system

### Prototypes (Throw Away the Code)
Use when you need to investigate a specific risk:

- UI layout, algorithm performance, database load, third-party integration
- Built to learn, not to keep
- Intentionally disposable — never evolve a prototype into production code

---

## 13. Version Control & CI/CD

### Version Control Rules

- **Always use version control** — for everything, including documentation and configuration. It is a time machine for your work.
- **Use version control to drive builds, tests, and releases** — commits and pushes trigger the pipeline automatically.
- **Tag production deployments** — use explicit version control tags to mark and trigger production releases.
- **Commit messages use Conventional Commits format**: `type(scope): description`
  - Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`
  - Scope should match the project area (e.g., `api`, `web`, `auth`, `db`)
  - Message describes **why**, not what — the diff shows what changed

### Pull Requests

- **Keep PRs small and focused** — one logical change per PR. Stop shipping massive PRs.
- **Use stacked PRs** for large features — break into reviewable layers instead of one giant diff.
- **Every PR must pass**: linting, automated tests, static analysis, and security scanning before merge.

### CI/CD Pipeline

- **Full automation** of builds, tests, and deployments — no manual procedures.
- **Tests run on every commit** — the pipeline is a conveyor belt; code is verified before it merges.
- **Catch bugs before merging** — automated tests must run inside the pipeline so defects are found before reaching the main branch.
- **Integrate issue tracking** — CI/CD tools should connect directly to defect tracking platforms for automatic feedback.
- **Maintain your automation** — regularly update and maintain build/test/deploy tooling.

---

## 14. Estimation & Planning

- **Estimate before starting** to spot problems early
- Break large tasks **top-down** into smaller parts; estimate small tasks **bottom-up**
- Always provide a **range**, not a single number
- **Iterate the schedule with the code** — refine estimates as implementation reveals reality
- State assumptions explicitly — estimates are only as good as their assumptions

---

## 15. Code Quality Checklist

Before considering any code complete, verify:

- [ ] Every function has a clear, single responsibility
- [ ] No knowledge is duplicated across the codebase
- [ ] Dependencies point inward (business logic has no framework imports)
- [ ] All external dependencies are behind interfaces
- [ ] Naming expresses intent clearly
- [ ] Error handling is explicit — crash early on impossible states
- [ ] Resources are allocated and deallocated by the same owner
- [ ] No shared mutable state without explicit synchronization
- [ ] Tests exist for business rules, boundaries, and integration points
- [ ] All tests pass
- [ ] No code was written "just in case" — every line serves a current need
- [ ] The code is easier to change than before you touched it
