# Design System

## Visual Direction

The app must feel like:
- Linear
- Stripe Dashboard
- Notion
- modern B2B SaaS
- premium internal sales OS

Avoid:
- generic Bootstrap admin panel
- harsh colors
- cluttered tables
- tiny unreadable text
- AI-generated messy gradients everywhere

## UI Stack

Use:
- Tailwind CSS
- shadcn/ui
- Framer Motion
- Lucide React
- Recharts

## Layout

Desktop-first.

Main layout:
- fixed left sidebar
- top bar
- main content area
- page header with title/description/actions
- cards and tables

## Components

Required components:
- AppSidebar
- Topbar
- PageHeader
- MetricCard
- StatusPill
- FitScoreBadge
- ConfidenceBadge
- CompanyTable
- ContactTable
- PipelineProgress
- EmptyState
- LoadingSkeleton
- ErrorState
- AIResearchCard
- OutreachEditor
- MeetingCard
- LogTable
- CostUsageMeter

## Status Pill Colors

Use subtle colors:
- imported: gray
- research_pending: amber
- researching: blue
- researched: indigo
- qualified: emerald
- approved: green
- contacted: sky
- replied: purple
- meeting_booked: violet
- won: green
- lost: red
- rejected: muted red/gray

## Motion

Use subtle Framer Motion:
- page fade/slide
- card hover
- drawer open
- list item appearance

No excessive animations.
