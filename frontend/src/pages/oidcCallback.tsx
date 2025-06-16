import { useEffect } from "react";

const OidcCallback = () => {
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get("code");
        const state = urlParams.get("state");

        fetch(`/api/v1/auth/oidc/callback?code=${code}&state=${state}`)
            .then(res => res.json())
            .then(data => {
                localStorage.setItem("fiabtoken", data.access_token);
                // redirect to app home
                window.location.href = "/";
            });
    }, []);

    return null;
};

export default OidcCallback;
