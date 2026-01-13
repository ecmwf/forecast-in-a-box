set -euo pipefail
REPO="ecmwf/forecast-in-a-box"

# Example usage: ./issueAutomation.sh file
# `file` content is like:
# Feature;<feature title>;<comma-separated labels>
# Task;<task title>;<comma-separated labels>
# Task;<task title>;<comma-separated labels>
#
# Each task is blocking the feature above
# Labels be like `backend`, `frontend`, `fullstack`
#
# real example:
# Feature;Automated model checkpoint downnloads;
# Task;Provide model checkpoint status in fable building;backend,fullstack
# Task;Display model checkpoint status;frontend,fullstack
# Task;Issue model checkpoint download in fable compilation;backend




# Function: Creates an issue and returns its Number
# Args: $1=type (feature/task), $2=title, $3=labels
createIssue() {
    local type="$1"
    local title="$2"
    local labels="$3"
    local labels_json=$(echo $labels | sed 's/[^,][^,]*/"&"/g')

    # these two dont really work -- the first doesnt return value, the second just... doesnt work
    # issue_number=$(gh issue create --title "[$type] $title" --label "$all_labels" --body "Created via automation script." --json number --jq '.number')
    # issue_number=$(gh api --method POST -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" /repos/:owner/:repo/issues -f body="{\"title\": \"$title\", \"body\": \"Automagic\", \"labels\": [$all_labels]}" | jq .number)
    issue_number=$(curl -s -L -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer $(gh auth token)" -H "X-GitHub-Api-Version: 2022-11-28" https://api.github.com/repos/$REPO/issues -d "{\"title\": \"$title\", \"body\": \"Automagic\", \"labels\": [$labels_json], \"type\": \"$type\"}" | jq .number)

    echo $issue_number
}

# Function: Marks Issue A as blocking Issue B
# Args: $1=Main Issue Number (Feature), $2=Dependent Number (Task)
markBlocking() {
    local feature_number="$1"
    local task_number="$2"

    local task_id=$(gh api /repos/:owner/:repo/issues/$task_number | jq .id)

    >&2 echo  "Linking: TaskID $task_id will block Feature #$feature_number"

    # gh client doesnt support setting blocked_by, and gh api has an integer range problem
    curl -s -L -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer $(gh auth token)" -H "X-GitHub-Api-Version: 2022-11-28" https://api.github.com/repos/$REPO/issues/$feature_number/dependencies/blocked_by -d "{\"issue_id\":$task_id}" > /dev/null
}

# --- Main Logic ---

last_feature_id=""

while IFS=';' read -r type name labels || [ -n "$type" ]; do
    # Skip empty lines or comments
    [[ -z "$type" || "$type" == \#* ]] && continue

    >&2 echo "Processing $type: $name..."
    
    current_number=$(createIssue "$type" "$name" "$labels")
    
    if [[ "$type" == "Feature" ]]; then
        last_feature_number="$current_number"
        >&2 echo "New Feature Number: $last_feature_number"
    elif [[ "$type" == "Task" ]]; then
        if [[ -n "$last_feature_number" ]]; then
            markBlocking "$last_feature_number" "$current_number"
        else
            >&2 echo "Warning: Task '$name' found before any feature. Skipping link."
        fi
    fi

    echo "--------------------------"
done < "$1"
