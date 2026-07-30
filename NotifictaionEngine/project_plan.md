# Notification Engine

## 1. Project Description
A premium enterprise-grade Notification Configuration Studio that integrates with Kissflow. Business users and administrators configure automated notifications for Kissflow Applications, Dataforms, Processes, and Boards. The application provides a complete notification lifecycle management experience including template building, scheduler configuration, rule-based triggers, and execution monitoring.

## 2. Page Structure
- `/` - Home (Application Workspace - displays all Kissflow Applications as resource cards)
- `/applications/:id` - Application Details (Overview, Dataforms, Processes, Boards, Settings tabs)
- `/applications/:id/dataforms/:formId` - Dataform Workspace (Three-panel notification builder)
- `/templates` - Email Template Builder (Reusable templates with version history)
- `/schedulers` - Scheduler Management
- `/history` - Notification History (Data table with filtering)
- `/logs` - Execution Logs (Enterprise log viewer with drawer)
- `/settings` - Settings (SMTP, Channels, Retry Policy, etc.)

## 3. Core Features
- [ ] Application Workspace with resource cards
- [ ] Application Details with tabbed navigation
- [ ] Dataform three-panel notification builder (Field Explorer + Builder + Live Preview)
- [ ] Email Template Builder with WYSIWYG editor and variable insertion
- [ ] Scheduler Builder with cron support and trigger conditions
- [ ] Rule Builder (visual IF/THEN condition builder)
- [ ] Recipient Builder with multi-type selection
- [ ] Notification History table with filtering and export
- [ ] Execution Logs with timeline drawer
- [ ] Settings (SMTP, channels, policies)
- [ ] Floating sidebar with collapsed/expanded modes
- [ ] Sticky header with breadcrumb, search, notifications

## 4. Data Model Design
No database required initially - using mock data.

## 5. Backend / Third-party Integration Plan
- Supabase: Not required initially
- Kissflow API: Mock data for now, real integration can be added later

## 6. Development Phase Plan

### Phase 1: Core Layout + Home Page
- Goal: Build the floating sidebar, sticky header, and Application Workspace homepage
- Deliverable: Complete shell layout with all navigation, home page with mock application cards

### Phase 2: Application Details + Dataforms List
- Goal: Application details page with tabbed navigation, overview tab, and dataforms list
- Deliverable: Full application details experience with compact dataform cards

### Phase 3: Email Template Builder
- Goal: Reusable template management with version history, drag-drop block editor, save draft, publish, and test email
- Deliverable: Templates list page, full template builder with block palette, block editor, live preview, version history panel, variables drawer, and test email dialog

### Phase 4: Scheduler Builder
- Goal: Accordion-based scheduler configuration with cron support, event-based triggers, and execution preview
- Deliverable: Full scheduler list page, scheduler builder workspace with 6 collapsible config sections, cron expression builder with presets, trigger condition config, and live execution preview
- Status: COMPLETE

### Phase 5: Rule Builder + Recipient Builder + History + Logs
- Goal: Visual rule builder, recipient configuration, notification history table, execution logs
- Deliverable: Complete notification lifecycle management

### Phase 6: Settings + Polish
- Goal: Settings page, micro-interactions, animations, responsive polish
- Deliverable: Production-ready polished application