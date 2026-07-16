import { navigateTo } from '../../router/index.js';

// Página estática de Términos y Condiciones / Política de Privacidad.
// No consulta al backend: el texto vive aquí. Se elige qué mostrar con el
// query param ?type= (terminos | privacidad); por defecto muestra "terminos".
// Es una ruta "alwaysAccessible" (ver router): se puede ver con o sin sesión.
const CONTENT = {
    terminos: {
        title: 'Términos y Condiciones',
        body: `
            <p>Al usar Kinora aceptas que la plataforma se encuentra en fase beta y que
            algunas funcionalidades pueden cambiar sin previo aviso.</p>
            <p>Los coaches son responsables de la exactitud de la información que registran
            sobre sus atletas. Los atletas acceden únicamente a las rutinas y datos que su
            coach les asigna.</p>
            <p>El uso indebido de la plataforma, incluyendo la creación de cuentas falsas o
            el acceso no autorizado a información de otros usuarios, puede resultar en la
            suspensión de la cuenta.</p>
        `
    },
    privacidad: {
        title: 'Política de Privacidad',
        body: `
            <p>Kinora almacena únicamente los datos necesarios para operar la plataforma:
            nombre, email, documento, fecha de nacimiento de los atletas, así como
            las rutinas asignadas por su coach.</p>
            <p>No compartimos esta información con terceros. Los atletas pueden solicitar a
            su coach la actualización o eliminación de sus datos en cualquier momento.</p>
            <p>Las contraseñas temporales generadas al crear una cuenta deben ser cambiadas
            por el usuario en cuanto sea posible.</p>
        `
    }
};

export function initLegal() {
    const backLink = document.getElementById('legal-back');
    backLink.addEventListener('click', (event) => {
        event.preventDefault();
        navigateTo('/');
    });

    // Lee ?type= de la URL y pinta el contenido correspondiente.
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');
    const content = CONTENT[type] || CONTENT.terminos;

    document.getElementById('legal-title').textContent = content.title;
    document.getElementById('legal-body').innerHTML = content.body;
}
