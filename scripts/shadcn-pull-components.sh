#!/bin/bash

# This script pulls components from ui.shadcn.com. The components are 
# documented at https://ui.shadcn.com/docs/components where you can add
# more to the list.

# The script automatically pulls the components into src/components/ui.

# ==============================================================================
# CONFIGURATION: Edit this list to change which components are updated
# Use kebab-case (e.g., 'alert-dialog', 'input-otp')
# ==============================================================================
COMPONENTS=(
  accordion
  alert
  badge
  button
  card
  carousel
  checkbox
  collapsible
  dialog
  drawer
  dropdown-menu
  input
  label
  popover
  progress
  radio-group
  scroll-area
  select
  separator
  sheet
  skeleton
  slider
  sonner
  spinner
  switch
  table
  tabs
  textarea
  tooltip
)

# ==============================================================================
# EXECUTION LOGIC
# ==============================================================================

echo "🚀 Starting ShadCN component update..."
echo "📦 Target components: ${#COMPONENTS[@]}"

# Convert array to space-separated string for the command
COMPONENT_LIST="${COMPONENTS[*]}"

# Run the command using Bun
# We use --bun to ensure it uses the Bun runtime for speed
if bunx --bun shadcn@latest add $COMPONENT_LIST; then
  echo "✅ Successfully updated all components!"
else
  echo "❌ Error: Component update failed. Check the output above."
  exit 1
fi