def extract_auth_token_from_response(response):
    """
    Extracts the authentication token from the response cookies.

    Will look for the `forecastbox_auth` cookie in the response,
    including in any redirects that may have occurred.

    Args:
        response (httpx.Response): The HTTP response object.

    Returns:
        str: The authentication token if found, otherwise None.
    """
    cookies = response.cookies
    if cookies:
        return cookies.get("forecastbox_auth")
    if response.history:
        for resp in response.history:
            if resp.cookies:
                return resp.cookies.get("forecastbox_auth")
    return None


def prepare_cookie_with_auth_token(token):
    """
    Prepares a cookie with the authentication token.

    Args:
        token (str): The authentication token to be set in the cookie.

    Returns:
        dict: A dictionary representing the cookie with the token.
    """
    return {"name": "forecastbox_auth", "value": token}
