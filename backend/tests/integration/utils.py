def extract_auth_token_from_response(response) -> None | str:
    """Extracts the authentication token from the response cookies.

    Will look for the `forecastbox_auth` cookie in the response,
    including in any redirects that may have occurred.

    Parameters
    ----------
    response: httpx.Response
        The HTTP response object from which to extract the token.

    Returns
    -------
    None | str
        The authentication token if found, otherwise None.
    """
    cookies = response.cookies
    if cookies:
        return cookies.get("forecastbox_auth")
    if response.history:
        for resp in response.history:
            if resp.cookies:
                return resp.cookies.get("forecastbox_auth")
    return None


def prepare_cookie_with_auth_token(token) -> dict:
    """Prepares a cookie with the authentication token.

    Parameters
    ----------
    token: str
        The authentication token to be set in the cookie.

    Returns
    -------
    dict:
        A dictionary representing the cookie with the token.
    """
    return {"name": "forecastbox_auth", "value": token}
