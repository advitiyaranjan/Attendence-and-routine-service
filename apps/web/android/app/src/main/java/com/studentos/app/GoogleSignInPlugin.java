package com.studentos.app;

import android.content.Intent;
import android.os.CancellationSignal;

import androidx.activity.result.ActivityResult;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CredentialOption;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

/**
 * Google sign-in inside the app. The ID token is issued for the web client id
 * (serverClientId), which the server checks; Google matches the app itself against the
 * Android OAuth client (package + signing SHA-1).
 *
 * Three ways, tried in turn by the web app, because some phones fail one of them
 * (e.g. Credential Manager's "[16] Account reauth failed"):
 *  - "button": Credential Manager, Sign in with Google picker
 *  - "sheet":  Credential Manager, Google ID bottom sheet (all accounts)
 *  - "legacy": classic Google Sign-In from Play services
 */
@CapacitorPlugin(name = "GoogleSignIn")
public class GoogleSignInPlugin extends Plugin {

    /** { serverClientId, nonce?, method? } → { idToken }. Rejects with code "cancelled" or "failed". */
    @PluginMethod
    public void signIn(PluginCall call) {
        String clientId = call.getString("serverClientId");
        if (clientId == null || clientId.isEmpty()) {
            call.reject("serverClientId is required");
            return;
        }
        String method = call.getString("method", "button");
        if ("legacy".equals(method)) {
            legacy(call, clientId);
            return;
        }
        String nonce = call.getString("nonce");
        CredentialOption option;
        if ("sheet".equals(method)) {
            GetGoogleIdOption.Builder b = new GetGoogleIdOption.Builder().setServerClientId(clientId).setFilterByAuthorizedAccounts(false).setAutoSelectEnabled(false);
            if (nonce != null) b.setNonce(nonce);
            option = b.build();
        } else {
            GetSignInWithGoogleOption.Builder b = new GetSignInWithGoogleOption.Builder(clientId);
            if (nonce != null) b.setNonce(nonce);
            option = b.build();
        }
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();

        CredentialManager.create(getContext()).getCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse result) {
                    Credential c = result.getCredential();
                    if (c instanceof CustomCredential && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                        try {
                            resolveToken(call, GoogleIdTokenCredential.createFrom(c.getData()).getIdToken());
                        } catch (Exception e) {
                            call.reject("Google sign-in failed", "failed", e);
                        }
                    } else {
                        call.reject("Unexpected credential", "failed");
                    }
                }

                @Override
                public void onError(@NonNull GetCredentialException e) {
                    // Keep Google's own wording: "[16] Account reauth failed", "[28444] Developer console is not set up correctly", ...
                    String detail = e.getType() + (e.getMessage() == null ? "" : ": " + e.getMessage());
                    call.reject(detail, e instanceof GetCredentialCancellationException ? "cancelled" : "failed", e);
                }
            }
        );
    }

    // -------------------------------------------------------------------------
    // Classic Google Sign-In (deprecated by Google but still the most widely working path)

    private void legacy(PluginCall call, String clientId) {
        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN).requestIdToken(clientId).requestEmail().build();
        GoogleSignInClient client = GoogleSignIn.getClient(getActivity(), gso);
        // Always show the account chooser rather than silently reusing the last account.
        client.signOut().addOnCompleteListener(t -> startActivityForResult(call, client.getSignInIntent(), "legacyResult"));
    }

    @ActivityCallback
    private void legacyResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        try {
            GoogleSignInAccount account = GoogleSignIn.getSignedInAccountFromIntent(data).getResult(ApiException.class);
            String token = account == null ? null : account.getIdToken();
            if (token == null) call.reject("legacy: no ID token", "failed");
            else resolveToken(call, token);
        } catch (ApiException e) {
            // 12501 = closed by the user; 10 = developer error (package / SHA-1 / client id); 7 = network.
            int code = e.getStatusCode();
            call.reject("legacy: [" + code + "] " + com.google.android.gms.common.api.CommonStatusCodes.getStatusCodeString(code), code == 12501 ? "cancelled" : "failed", e);
        }
    }

    private static void resolveToken(PluginCall call, String token) {
        JSObject res = new JSObject();
        res.put("idToken", token);
        call.resolve(res);
    }
}
