# needs to be standalone because we source this
VENV_COPY=$VIRTUAL_ENV
deactivate
rm -rf $VENV_COPY

# TODO these two variables should be stack-based instead, ie, dont unset but restore previous state instead
# We would then not need the checks either -- prepare*Venv pushes, tearDownVenv pops
if [[ -n "$UV_PROJECT_ENVIRONMENT" ]] ; then
    if [[ "$UV_PROJECT_ENVIRONMENT" == "$VENV_COPY" ]] ; then
        unset UV_PROJECT_ENVIRONMENT
    fi
fi
if [[ -n "$UV_NO_PROJECT" ]] ; then
    if [[ "$UV_NO_PROJECT" == "1" ]] ; then
        unset UV_NO_PROJECT
    fi
fi

