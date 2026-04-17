#!/bin/bash

set -x

# NOTE assumes below that `-p` is for custom non-interactive prompt
AGENT="copilot --allow-all $EXTRA_AGENT" 
# AGENT="echo -e"

if [[ $# -ge 1 ]]; then
  cmd_name="${1#/}"
  prompt_file=".prompts/${cmd_name}.md"
  shift
  if [ -f "$prompt_file" ]; then
    # Start copilot with the prompt file content prepended
    $AGENT -p "This is your task:\n$(cat $prompt_file). The parameter values, in the listed order, are: $*"
  else
    echo "Prompt $prompt_file not found."
  fi
else
  $AGENT "$@"
fi
